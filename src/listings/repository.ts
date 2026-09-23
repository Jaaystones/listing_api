import type { Pool } from "../db/pool.js";
import {
  MAX_COUNTED_RESULTS,
  type CreateListingInput,
  type ListingType,
  type SearchQuery,
  type UpdateListingInput,
} from "./schemas.js";

export interface Listing {
  id: string;
  title: string;
  price: number;
  type: ListingType;
  bedrooms: number;
  location: { lat: number; lng: number };
  agentId: string;
  createdAt: string;
  updatedAt: string;
  /** Only present on geo searches: distance from the search point, in km. */
  distanceKm?: number;
}

export interface Page<T> {
  items: T[];
  /** Number of matches, capped at MAX_COUNTED_RESULTS. */
  total: number;
  /** False when there are more matches than MAX_COUNTED_RESULTS; `total` is then a lower bound. */
  totalExact: boolean;
}

interface ListingRow {
  id: string;
  title: string;
  price: number;
  type: ListingType;
  bedrooms: number;
  lat: number;
  lng: number;
  agent_id: string;
  created_at: Date;
  updated_at: Date;
  distance_km?: number;
}

const COLUMNS = `
  id, title, price, type, bedrooms,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  agent_id, created_at, updated_at`;

const point = (lngParam: string, latParam: string) =>
  `ST_SetSRID(ST_MakePoint(${lngParam}, ${latParam}), 4326)::geography`;

function toListing(row: ListingRow): Listing {
  const listing: Listing = {
    id: row.id,
    title: row.title,
    price: row.price,
    type: row.type,
    bedrooms: row.bedrooms,
    location: { lat: row.lat, lng: row.lng },
    agentId: row.agent_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (row.distance_km !== undefined) listing.distanceKm = Math.round(row.distance_km * 1000) / 1000;
  return listing;
}

export class ListingRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateListingInput): Promise<Listing> {
    const { rows } = await this.pool.query<ListingRow>(
      `INSERT INTO listings (title, price, type, bedrooms, location, agent_id)
       VALUES ($1, $2, $3, $4, ${point("$5", "$6")}, $7)
       RETURNING ${COLUMNS}`,
      [input.title, input.price, input.type, input.bedrooms, input.location.lng, input.location.lat, input.agentId],
    );
    return toListing(rows[0]);
  }

  async findById(id: string): Promise<Listing | null> {
    const { rows } = await this.pool.query<ListingRow>(`SELECT ${COLUMNS} FROM listings WHERE id = $1`, [id]);
    return rows[0] ? toListing(rows[0]) : null;
  }

  async update(id: string, input: UpdateListingInput): Promise<Listing | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (value: unknown) => `$${params.push(value)}`;

    if (input.title !== undefined) sets.push(`title = ${add(input.title)}`);
    if (input.price !== undefined) sets.push(`price = ${add(input.price)}`);
    if (input.type !== undefined) sets.push(`type = ${add(input.type)}`);
    if (input.bedrooms !== undefined) sets.push(`bedrooms = ${add(input.bedrooms)}`);
    if (input.agentId !== undefined) sets.push(`agent_id = ${add(input.agentId)}`);
    if (input.location !== undefined) {
      sets.push(`location = ${point(add(input.location.lng), add(input.location.lat))}`);
    }
    sets.push("updated_at = now()");

    const { rows } = await this.pool.query<ListingRow>(
      `UPDATE listings SET ${sets.join(", ")} WHERE id = ${add(id)} RETURNING ${COLUMNS}`,
      params,
    );
    return rows[0] ? toListing(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM listings WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  }

  /**
   * Filtered, paginated search. Without a point, results are newest first. With lat/lng/radiusKm,
   * results are limited to the radius and ordered nearest first (ties broken by id).
   *
   * Distances use a sphere (PostGIS `<->` and use_spheroid = false). That is within ~0.5% of the
   * spheroid, which is plenty for property search, and lets one metric drive the radius filter,
   * the ordering, the index-assisted nearest-neighbour scan and the returned distanceKm.
   */
  async search(query: Partial<SearchQuery> & { page: number; limit: number }): Promise<Page<Listing>> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (value: unknown) => `$${params.push(value)}`;

    if (query.type?.length) where.push(`type = ANY(${add(query.type)}::listing_type[])`);
    if (query.minPrice !== undefined) where.push(`price >= ${add(query.minPrice)}`);
    if (query.maxPrice !== undefined) where.push(`price <= ${add(query.maxPrice)}`);
    if (query.bedrooms !== undefined) where.push(`bedrooms = ${add(query.bedrooms)}`);
    if (query.minBedrooms !== undefined) where.push(`bedrooms >= ${add(query.minBedrooms)}`);
    if (query.maxBedrooms !== undefined) where.push(`bedrooms <= ${add(query.maxBedrooms)}`);
    if (query.agentId !== undefined) where.push(`agent_id = ${add(query.agentId)}`);

    const isGeo = query.lat !== undefined && query.lng !== undefined && query.radiusKm !== undefined;
    const origin = isGeo ? point(add(query.lng), add(query.lat)) : "";
    const radiusM = isGeo ? add(query.radiusKm! * 1000) : "";
    if (isGeo) where.push(`ST_DWithin(location, ${origin}, ${radiusM}, false)`);

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const filterParams = [...params]; // the count query needs only these

    // Counting every match is the slowest part of a broad search (a full scan of the matches),
    // so stop at MAX_COUNTED_RESULTS and report the total as a lower bound past that.
    const countSql = `
      SELECT count(*)::int AS total
      FROM (SELECT 1 FROM listings ${whereSql} LIMIT ${MAX_COUNTED_RESULTS + 1}) matches`;

    const offset = (query.page - 1) * query.limit;
    let pageSql: string;
    if (isGeo) {
      // Sorting by (distance, id) stops Postgres using the GiST index's nearest-neighbour scan,
      // so a wide radius meant computing and sorting the distance of every match (~1 s for
      // 300k rows). Instead: (1) a nearest-neighbour scan finds the distance of the last row
      // this page needs, then (2) only rows within that distance are sorted exactly. Rows tied
      // on distance (same building) are all within it, so pages stay stable.
      pageSql = `
        WITH boundary AS (
          SELECT location <-> ${origin} AS d FROM listings ${whereSql}
          ORDER BY location <-> ${origin}
          OFFSET ${add(offset + query.limit - 1)} LIMIT 1
        )
        SELECT ${COLUMNS}, (location <-> ${origin}) / 1000.0 AS distance_km
        FROM listings ${whereSql}
          -- +1 cm guards against float rounding at the boundary; if the page runs past the
          -- last match there is no boundary row and the full radius applies.
          AND ST_DWithin(location, ${origin}, COALESCE((SELECT d FROM boundary) + 0.01, ${radiusM}), false)
        ORDER BY location <-> ${origin}, id
        LIMIT ${add(query.limit)} OFFSET ${add(offset)}`;
    } else {
      pageSql = `
        SELECT ${COLUMNS} FROM listings ${whereSql}
        ORDER BY created_at DESC, id DESC
        LIMIT ${add(query.limit)} OFFSET ${add(offset)}`;
    }

    const [itemsResult, countResult] = await Promise.all([
      this.pool.query<ListingRow>(pageSql, params),
      this.pool.query<{ total: number }>(countSql, filterParams),
    ]);

    const counted = countResult.rows[0].total;
    return {
      items: itemsResult.rows.map(toListing),
      total: Math.min(counted, MAX_COUNTED_RESULTS),
      totalExact: counted <= MAX_COUNTED_RESULTS,
    };
  }
}
