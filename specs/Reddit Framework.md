### **Devvit Data Normalization & Analytics Framework**

#### **1\. Framework Overview**

This framework implements a "Staging and Shredding" architecture. It treats the Reddit app execution as an ETL (Extract, Transform, Load) pipeline.

* **Stage 1 (Ingestion):** Quick write of the raw JSON snapshot to a "Loading Table" (Redis Hash).  
* **Stage 2 (Normalization):** A background process wakes up, locks the record, and "shreds" the JSON into optimized, non-redundant Redis structures.  
* **Stage 3 (Analysis):** Data is indexed for time-range retrieval and word frequency analysis.

---

#### **2\. Redis Database Schema**

We will map your requested "Tables" to Redis data structures to ensure zero redundancy.

**A. The Loading Table (Staging)**

* **Key:** `staging:snapshot:latest`  
* **Type:** `String` (containing serialized JSON)  
* **Purpose:** Fast ingestion. The import process simply dumps the file here and triggers the worker.

**B. Master Post Table (Static Data)**

* **Key:** `post:{created_utc}:static`  
* **Type:** `Hash`  
* **Fields:**  
  * `title`, `url`, `author`, `is_self`, `flair`, `created_utc`  
* **Logic:** Written **only** if `EXISTS post:{created_utc}:static` returns 0\. This guarantees the "static fields will never change" rule.

**C. Post Stats Table (Dynamic/Volatile Data)**

* **Key:** `post:{created_utc}:dynamic`  
* **Type:** `Sorted Set (ZSET)`  
* **Purpose:** Stores the changing metrics associated with the static record.  
* **Member Format:** `{timestamp}:{score}:{comments}:{engagement}:{max_depth}`  
* **Score:** `{timestamp}` (Scanning Date)  
* **Optimization:** This allows you to pull a specific snapshot's stats or a range of history using `ZRANGEBYSCORE`.

**D. Run Meta & Stats (The Snapshot Record)**

* **Key:** `run:{scan_id}:meta` (Hash) → Stores Subreddit, Timestamp.  
* **Key:** `run:{scan_id}:stats` (Hash) → Stores Subscribers, Active, Velocity metrics.  
* **Key:** `run:{scan_id}:list:{type}` (List) → Stores the list order (e.g., Top, Rising). Contains only the `created_utc` reference key and the rank index (1-25).

---

#### **3\. The Importer & Normalization Process**

This process is designed to handle the \~1,000 record loop efficiently within execution limits.

**Step 1: The Trigger (Loader)**

TypeScript

`// Fast Ingestion  
async function importSnapshot(jsonData: any, context: Context) {  
  // 1\. Save to Loading Table  
  await context.redis.set('staging:snapshot:latest', JSON.stringify(jsonData));  `

`  // 2\. Kick off the Normalization Process immediately  
  await context.scheduler.runJob({  
    name: 'normalization\_worker',  
    runAt: new Date() // Immediate execution  
  });  
}`

**Step 2: The Normalization Worker**

This worker reads the loading table and shreds the data. It prioritizes the **Analysis Pool** first, as requested, to generate Master Records before processing Lists.

* **Phase 1: Analysis Pool (Master Records)**  
  * Iterate through the `analysis_pool` array.  
  * **Check:** `EXISTS post:{created_utc}:static`.  
  * **If Match (True):** Skip static write.  
  * **If No Match (False):** Generate sequential ID (or use `created_utc` as natural key). `HMSET` static fields.  
  * **Always:** Append dynamic stats to `post:{created_utc}:dynamic` using `ZADD`.  
  * **Optimization:** Use `Promise.all` to batch Redis calls in groups of 10-20 to prevent timeout, rather than awaiting them one by one.  
* **Phase 2: Meta & Stats**  
  * Generate a `scan_id` (e.g., `INCR global:scan_counter)`.  
  * Save `run:{scan_id}:meta` and `run:{scan_id}:stats`.  
* **Phase 3: Lists (T, D, E, R, H, C)**  
  * Loop through the lists in the JSON.  
  * For each entry, look up the `created_utc`.  
  * Save to `run:{scan_id}:list:{type}` storing `{created_utc}:{rank_position}`.

---

#### **4\. Word Cloud & Stop Words Optimization**

You asked to investigate if Redis can handle word clouds and stop words efficiently.

**Investigation Result:**

While standard Redis has modules (RediSearch) that handle tokenization and stop words automatically, the **Devvit Redis instance does not support Modules**. It is a pure Key-Value store.

**The Optimized Solution:**

We will implement a **Manual Inverted Index** using `Sorted Sets (ZSET)`. This is faster than processing text on every read.

1. **Stop Words:**  
   * Since we cannot rely on a server-side Redis stop-word list, we must define a `STOP_WORDS` Set in the application code (TypeScript).  
   * *Optimization:* Convert this list to a `Set<string>` for O(1) lookup speed during the normalization loop.  
   * *List:* `['the', 'is', 'at', 'which', 'on', 'and', 'a',...]`  
2. **Word Cloud Generation (During Normalization):**  
   * When processing a *new* Master Record (checking `created_utc`):  
   * Sanitize Title: `lowercase` \-\> `remove punctuation`.  
   * Tokenize: Split by space.  
   * Filter: `if (!STOP_WORDS.has(token))`  
   * Update Redis: `ZINCRBY global:word_cloud 1 {token}`  
3. *Result:* `global:word_cloud` becomes a pre-calculated, sorted list of top words. You can retrieve the top 50 instantly with `ZREVRANGE global:word_cloud 0 49 WITHSCORES`.

---

#### **5\. Scheduling & Automation**

To handle the "Recurring," "One-off," and "Cancel" requirements, we utilize the Devvit Scheduler API.

**A. Recurring Job (The "Cron")**

To run the snapshot automatically (e.g., every hour):

TypeScript

`// In devvit.json or setup  
context.scheduler.runJob({  
  cron: "0 \* \* \* \*", // Run at minute 0 of every hour  
  name: "scheduled\_snapshot\_runner",  
  data: { subreddit: "target\_sub" }  
});`

**B. One-Off Job**

For a single, delayed run (e.g., retry a failed snapshot):

TypeScript

`context.scheduler.runJob({  
  runAt: new Date(Date.now() \+ 1000 \* 60 \* 5), // Run in 5 mins  
  name: "one\_off\_retry",  
  data: { scan\_id: "12345" }  
});`

C. Canceling Jobs (The "Stop" Button)

To allow cancellation, we must store the jobId returned by the scheduler, as there is no "list all jobs" command that filters easily.

1. **Start:**  
   TypeScript  
   `const jobId \= await context.scheduler.runJob({... });  
   await context.redis.set('system:active\_job\_id', jobId);  `

2. **Stop:**  
   TypeScript  
   `const jobId \= await context.redis.get('system:active\_job\_id');  
   if (jobId) {  `
   
       await context.scheduler.cancelJob(jobId);  
       await context.redis.del('system:active\_job\_id');  
   
   `}  `

---

#### **6\. Retrieval & Trend Analysis**

**Retrieving Data:**

To reconstruct the JSON for the analysis report:

1. **Get Latest Run:** `GET global:scan_counter -> 1050`.  
2. **Get Run Meta:** `HGETALL run:1050:meta`.  
3. **Get List:** `LRANGE run:1050:list:T 0 -1`.  
4. **Hydrate Posts:**  
   * For each `created_utc` found in the list:  
   * **Static:** `HGETALL post:{created_utc}:static` (Title, Url).  
   * **Dynamic:** `ZRANGEBYSCORE post:{created_utc}:dynamic {scan_timestamp} {scan_timestamp}`.  
   * *Result:* This returns the exact score/comments at that specific moment in time, ensuring historical accuracy.

**Trend Calculation (Velocity):**

* Because we store dynamic stats in a ZSET keyed by time, we can calculate trends easily:  
  * `Current` \= Get Score at `Timestamp_Now`.  
  * `Previous` \= Get Score at `Timestamp_Now - 24h`.  
  * `Velocity` \= `Current` \- `Previous`.

#### **7\. Persistence Note**

You mentioned ensuring data is saved to disk. Devvit's Redis is persistent (backed by AOF/RDB on Reddit's infrastructure). However, by splitting the data into `Static` (written once) and `Dynamic` (appended), we ensure that even if a "Dynamic" write fails or is delayed, the "Static" core record remains safe on disk, preserving data integrity.
