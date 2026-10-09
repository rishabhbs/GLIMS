// Applies supabase/migrations/*.sql in filename order over the session pooler.
// Each file runs inside its own transaction. Reads DATABASE_URL from env.
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(2);
}

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

let failed = false;
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  process.stdout.write(`\n── applying ${file} … `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("OK");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log(`FAILED`);
    console.error(`   ${e.code ?? ""} ${e.message}`);
    if (e.position) console.error(`   at position ${e.position}`);
    failed = true;
    break;
  }
}

await client.end();
process.exit(failed ? 1 : 0);
