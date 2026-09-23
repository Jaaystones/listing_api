import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import { ListingRepository } from "../listings/repository.js";
import type { CreateListingInput } from "../listings/schemas.js";
import { createPool, type Pool } from "./pool.js";

const AGENT_A = "11111111-1111-4111-8111-111111111111";
const AGENT_B = "22222222-2222-4222-8222-222222222222";

export const SEED_LISTINGS: CreateListingInput[] = [
  {
    title: "3 bedroom flat, Lekki Phase 1",
    price: 6_500_000,
    type: "rent",
    bedrooms: 3,
    location: { lat: 6.4478, lng: 3.4723 },
    agentId: AGENT_A,
  },
  {
    title: "Luxury 4 bedroom terrace, Ikoyi",
    price: 450_000_000,
    type: "sale",
    bedrooms: 4,
    location: { lat: 6.4549, lng: 3.4346 },
    agentId: AGENT_A,
  },
  {
    title: "Studio shortlet, Victoria Island",
    price: 85_000,
    type: "shortlet",
    bedrooms: 0,
    location: { lat: 6.4281, lng: 3.4219 },
    agentId: AGENT_B,
  },
  {
    title: "2 bedroom apartment, Yaba",
    price: 2_800_000,
    type: "rent",
    bedrooms: 2,
    location: { lat: 6.5095, lng: 3.3711 },
    agentId: AGENT_B,
  },
  {
    title: "5 bedroom detached duplex, Ikeja GRA",
    price: 320_000_000,
    type: "sale",
    bedrooms: 5,
    location: { lat: 6.5833, lng: 3.3614 },
    agentId: AGENT_A,
  },
  {
    title: "1 bedroom mini flat, Surulere",
    price: 1_500_000,
    type: "rent",
    bedrooms: 1,
    location: { lat: 6.5006, lng: 3.3581 },
    agentId: AGENT_B,
  },
  {
    title: "4 bedroom semi-detached, Ajah",
    price: 95_000_000,
    type: "sale",
    bedrooms: 4,
    location: { lat: 6.4698, lng: 3.5852 },
    agentId: AGENT_A,
  },
  {
    title: "2 bedroom shortlet, Lekki Phase 1",
    price: 120_000,
    type: "shortlet",
    bedrooms: 2,
    location: { lat: 6.4433, lng: 3.4655 },
    agentId: AGENT_B,
  },
  {
    title: "3 bedroom apartment, Maitama",
    price: 12_000_000,
    type: "rent",
    bedrooms: 3,
    location: { lat: 9.0882, lng: 7.4991 },
    agentId: AGENT_A,
  },
  {
    title: "6 bedroom mansion, Asokoro",
    price: 850_000_000,
    type: "sale",
    bedrooms: 6,
    location: { lat: 9.0437, lng: 7.5272 },
    agentId: AGENT_B,
  },
  {
    title: "1 bedroom shortlet, Wuse 2",
    price: 65_000,
    type: "shortlet",
    bedrooms: 1,
    location: { lat: 9.0795, lng: 7.4702 },
    agentId: AGENT_A,
  },
  {
    title: "2 bedroom flat, Gwarinpa",
    price: 3_500_000,
    type: "rent",
    bedrooms: 2,
    location: { lat: 9.1099, lng: 7.4042 },
    agentId: AGENT_B,
  },
];

/** Inserts demo listings, but only into an empty table so restarts don't duplicate data. */
export async function seed(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM listings");
  if (rows[0].n > 0) return 0;
  const repo = new ListingRepository(pool);
  for (const listing of SEED_LISTINGS) await repo.create(listing);
  return SEED_LISTINGS.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool(config.databaseUrl);
  seed(pool)
    .then((n) => console.log(n ? `Seeded ${n} listings` : "Listings table not empty, skipping seed"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
