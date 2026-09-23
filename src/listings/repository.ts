import type { Pool } from "../db/pool.js";
import type { CreateListingInput, ListingType, SearchQuery, UpdateListingInput } from "./schemas.js";

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
  total: number;
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
   * Filtered, paginated search. When lat/lng/radiusKm are given, results are limited to
   * listings within the radius (ST_DWithin uses the GiST index) and ordered nearest first.
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

    let distanceSelect = "";
    let orderBy = "created_at DESC, id DESC";
    const isGeo = query.lat !== undefined && query.lng !== undefined && query.radiusKm !== undefined;
    if (isGeo) {
      const origin = point(add(query.lng), add(query.lat));
      where.push(`ST_DWithin(location, ${origin}, ${add(query.radiusKm! * 1000)})`);
      distanceSelect = `, ST_Distance(location, ${origin}) / 1000.0 AS distance_km`;
      orderBy = "distance_km ASC, id ASC";
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const filterParams = [...params];
    const limitParam = add(query.limit);
    const offsetParam = add((query.page - 1) * query.limit);

    const [itemsResult, countResult] = await Promise.all([
      this.pool.query<ListingRow>(
        `SELECT ${COLUMNS}${distanceSelect} FROM listings ${whereSql}
         ORDER BY ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
        params,
      ),
      this.pool.query<{ total: number }>(`SELECT count(*)::int AS total FROM listings ${whereSql}`, filterParams),
    ]);

    return { items: itemsResult.rows.map(toListing), total: countResult.rows[0].total };
  }
}
