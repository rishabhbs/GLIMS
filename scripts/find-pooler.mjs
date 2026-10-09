// Probes Supabase session-pooler regional hosts to find the one that accepts
// this project's credentials. Reads password from env; prints the working URL.
import pg from "pg";

const REF = "qtfqdfnfmcymmjeeinxk";
const PASSWORD = process.env.SUPABASE_DATABASE_PASSWORD;
if (!PASSWORD) {
  console.error("SUPABASE_DATABASE_PASSWORD not set");
  process.exit(2);
}

const regions = [
  "us-east-1", "us-east-2", "us-west-1", "eu-central-1", "eu-west-1",
  "eu-west-2", "eu-west-3", "ap-south-1", "ap-southeast-1", "ap-southeast-2",
  "ap-northeast-1", "ap-northeast-2", "sa-east-1", "ca-central-1",
];
const prefixes = ["aws-0", "aws-1"];

async function tryHost(host) {
  const client = new pg.Client({
    host,
    port: 5432,
    user: `postgres.${REF}`,
    password: PASSWORD,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 6000,
    statement_timeout: 6000,
  });
  try {
    await client.connect();
    const r = await client.query("select current_database() db, version() v");
    await client.end();
    return { ok: true, host, db: r.rows[0].db };
  } catch (e) {
    try { await client.end(); } catch {}
    return { ok: false, host, code: e.code, msg: e.message };
  }
}

for (const prefix of prefixes) {
  for (const region of regions) {
    const host = `${prefix}-${region}.pooler.supabase.com`;
    const res = await tryHost(host);
    if (res.ok) {
      console.log(`FOUND ${host}  db=${res.db}`);
      process.exit(0);
    }
    // Distinguish "wrong region/tenant" from "wrong password".
    if (res.code === "XX000" || /Tenant or user not found/i.test(res.msg)) {
      // wrong region — silent
    } else if (res.code === "28P01" || /password/i.test(res.msg)) {
      console.log(`AUTH-FAIL (right host, bad password?) ${host}: ${res.msg}`);
    } else {
      // connection/other — silent unless useful
    }
  }
}
console.log("NO-MATCH: no regional pooler host accepted the credentials");
process.exit(1);
