const { createClient } = require('redis');
async function run() {
  const client = createClient();
  await client.connect();
  const meta = await client.hGetAll('run:6:meta');
  const stats = await client.hGetAll('run:6:stats');
  const pool = await client.zRange('run:6:analysis_pool', 0, -1);
  console.log("Meta:", meta);
  console.log("Stats count:", Object.keys(stats).length);
  console.log("Pool count:", pool.length);
  process.exit(0);
}
run();
