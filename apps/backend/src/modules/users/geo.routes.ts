import type { FastifyInstance } from "fastify";
import { Country, City } from "country-state-city";
import { z } from "zod";

// Bundling country-state-city's full world dataset into the web client
// balloons that page's JS to several MB, so it's served from here instead --
// the client only ever downloads the one country's city list it asked for.

const citiesQuerySchema = z.object({ country: z.string().min(1) });

export default async function geoRoutes(fastify: FastifyInstance) {
  fastify.get("/geo/countries", async () => {
    const items = Country.getAllCountries().map((c) => ({ code: c.isoCode, name: c.name }));
    return { items };
  });

  fastify.get("/geo/cities", async (request) => {
    const { country } = citiesQuerySchema.parse(request.query);
    const items = (City.getCitiesOfCountry(country) ?? []).map((c) => c.name);
    return { items };
  });
}
