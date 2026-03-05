# **Comprehensive Architectural Framework for Statistical Tracking, Normalization, and Analytical Visualization on Reddit Devvit**

## **1\. Executive Summary**

The evolution of the Reddit Devvit platform has introduced a paradigm shift in how community-centric applications are architected, moving logic closer to the data source—the subreddit itself. However, this proximity introduces unique challenges in data persistence and resource management. This report articulates a rigorous, production-grade framework for implementing a high-fidelity statistical tracking system within the Devvit environment. The objective is to enable developers to capture high-frequency posting statistics, normalize this data to adhere to strict storage quotas, and leverage the captured metrics for advanced trend analysis and semantic visualization, specifically word clouds.

The proposed architecture departs from traditional monolithic database designs, favoring a highly distributed, key-value modeling strategy tailored to Redis. Central to this framework is the **Principle of Write-Time Normalization**, which mandates that data be shredded into its most atomic, deduplicated form immediately upon ingestion. This approach is necessitated by Devvit’s operational constraints, specifically the 500 MB storage cap per installation and the absence of complex server-side scripting (Lua). To ensure data integrity during this shredding process, the report introduces the **Loading Table Pattern**, a transactional buffer that decouples data fetching from data processing, thereby enhancing system resilience against execution timeouts and concurrency conflicts.

Furthermore, the report details the orchestration of this data pipeline using the **Devvit Scheduler**. It provides a blueprint for managing the lifecycle of automated snapshots through a hybrid strategy of recurring Cron jobs for longitudinal data and ephemeral one-off jobs for immediate maintenance. Finally, the investigation extends to the implementation of **Semantic Analysis Engines** within Redis, demonstrating how Sorted Sets (ZSETs) can be repurposed to generate real-time word clouds by simulating frequency analysis algorithms typically reserved for full-text search engines.

This document serves as an exhaustive guide for systems architects and senior engineers, providing the theoretical grounding, structural schemas, and algorithmic logic required to build scalable, analytics-driven applications on the Reddit Devvit platform.

## ---

**2\. Architectural Context and Operational Constraints**

To design a robust statistical tracking framework, one must first deeply understand the environment in which it operates. The Devvit runtime is a managed, serverless ecosystem that abstracts away much of the underlying infrastructure complexity. However, this abstraction imposes rigid boundaries that differ significantly from self-hosted or cloud-native environments like AWS Lambda or standard Redis Cloud instances. A failure to respect these boundaries results in applications that are fragile, non-performant, or incapable of scaling beyond trivial use cases.

### **2.1 The Devvit Redis Sandbox**

The Redis instance provided to Devvit applications is not a generic key-value store; it is a specialized, multi-tenant environment tuned for the specific patterns of Reddit app interaction.

#### **2.1.1 The Absence of Server-Side Scripting**

In traditional Redis architectures, developers heavily rely on Lua scripting (via the EVAL command) to ensure atomicity across complex operations. For example, a standard implementation of a "compare-and-swap" or a "fetch-process-update" loop would be encapsulated in a Lua script to execute on the server, guaranteeing that no other client modifies the data during the operation.

Devvit **explicitly disables Lua scripting**.1 This constraint is the single most influential factor in the proposed framework's design. It implies that all data manipulation logic must occur within the application layer (the TypeScript runtime). Consequently, every data mutation that depends on the current state of the database requires a network round-trip:

1. **Read:** Fetch data from Redis to the App.  
2. **Process:** Compute the new state in the App.  
3. **Write:** Send the new state back to Redis.

This architecture introduces the risk of **Race Conditions**. If two scheduled jobs trigger simultaneously (e.g., a recurring snapshot and a manual user refresh), they both might read the same initial state, modify it, and write back, with the last write overwriting the first (the "Lost Update" problem). To mitigate this, our framework rigorously employs **Optimistic Concurrency Control (OCC)** using Redis Transactions (MULTI/EXEC) and the WATCH command.2 The framework treats the database not just as a storage bucket, but as a synchronization primitive.

#### **2.1.2 Storage Quotas and Capacity Planning**

Devvit imposes a **hard storage limit of 500 MB per app installation**.1 While 500 MB appears generous for text data, it is deceptively finite when dealing with high-frequency time-series data.

Consider a naive implementation that stores a raw JSON snapshot of a Reddit post every 15 minutes to track score changes.

* **Average Post JSON Size:** \~5 KB (including metadata, flair, awards context).  
* **Snapshot Frequency:** $4/hr \times 24 \text{ hrs} = 96 \text{ times per day}$  
* **Daily Consumption:** $5 \text{ KB} \times 96 = 480 \text{ KB}$ per post per day.  
* **Scaling:** If an app tracks just 100 active posts simultaneously, it consumes $48 \text{ MB}$ per day.  
* **Saturation:** The 500 MB quota would be exhausted in roughly **10 days**.

This mathematical reality dictates that **Normalization** is not merely a "best practice" but a functional requirement. We cannot store redundancy. Static data (Title, Author, Creation Date) must be stored exactly once. Dynamic data (Score, Comments) must be stored as lightweight integers. Historical data must be pruned or compressed. The framework detailed in Section 4 addresses this specifically by splitting the data model into Static and Dynamic shards.

#### **2.1.3 Throughput and Command Limits**

The platform enforces a rate limit of **40,000 commands per second**.1 While this is a high ceiling for most interactions, it becomes relevant during bulk operations, such as generating a word cloud or migrating data schemas. If an application attempts to tokenize a long text post and writes 2,000 individual words to a Redis Sorted Set using individual ZINCRBY commands, it consumes 2,000 command units. If this is done for 20 posts in a batch job, the limit is breached.

Therefore, the framework prioritizes **Pipelining** (conceptually via Promise.all or MULTI blocks) to batch operations. Although true network pipelining is noted as "not supported" in some contexts 1, using MULTI blocks aggregates commands into a single request envelope, which is essential for both performance and quota adherence.

### **2.2 The "Single Source of Truth" Challenge**

In distributed systems, establishing a "Single Source of Truth" (SSOT) is critical. In Devvit, the Redis instance is siloed by subreddit.1 This means r/AskReddit and r/Funny have completely separate Redis key-spaces, even if the same app is installed on both.

* **Implication:** The framework does not need to handle cross-subreddit locking or ID collisions (e.g., Post ID t3\_xyz in one sub is distinct from data in another sub because the databases are isolated).  
* **Requirement:** However, within a single subreddit, multiple instances of the app (the scheduler, the user interface, the trigger handlers) all access the same Redis store. The Data Model must be robust enough to handle these concurrent access patterns without corruption.

## ---

**3\. Data Modeling Strategy: The Normalized Tripartite Schema**

To satisfy the requirement for "exhaustive detail" while respecting the 500 MB limit, we employ a **Tripartite Data Schema**. This strategy partitions data based on its mutability characteristics: **Immutable (Static)**, **Mutable (Dynamic)**, and **Temporal (Series)**.

### **3.1 Partition 1: The Static Entity Hash**

The Static Entity Hash stores the metadata of a post that is invariant. Once a post is created, its title, author, and creation timestamp do not change (with rare exceptions like admin edits, which we handle via lazy updates).

Key Design: app:scope:post:{post\_id}:static  
Data Structure: Redis Hash  
We utilize a Hash rather than a simple serialized JSON string because Hashes in Redis are memory-efficient and allow for field-level access (though HGET is often used to retrieve the whole object in Devvit).

| Field        | Data Type | Description    | Rationale                                  |
|:------------ |:--------- |:-------------- |:------------------------------------------ |
| title        | String    | Post Title     | Stored once to save space.                 |
| author       | String    | Username       | Used for "User History" aggregation later. |
| created\_utc | Number    | Unix Timestamp | Vital for age-based pruning policies.      |
| permalink    | String    | Relative URL   | For linking back to the content.           |
| is\_self     | Boolean   | Type Indicator | Differentiates text posts from link posts. |
| word\_count  | Number    | Integer        | Pre-computed length for analytics.         |

Storage Savings Analysis:  
By stripping these fields out of the recurring snapshots, we save approximately 500-1000 bytes per snapshot. Over 10,000 snapshots, this saves 5-10 MB of storage per post tracked.

### **3.2 Partition 2: The Dynamic State Hash**

The Dynamic State Hash represents the "Live View" of the entity. It is overwritten every time a snapshot job runs. This structure is optimized for **Read Availability**—when a user loads the "Stats" tab in the app, the UI fetches this single key to show the latest numbers instantly.

Key Design: app:scope:post:{post\_id}:dynamic  
Data Structure: Redis Hash

| Field       | Data Type | Description    | Rationale                           |
|:----------- |:--------- |:-------------- |:----------------------------------- |
| score       | Number    | Net Upvotes    | The primary metric of engagement.   |
| comments    | Number    | Total Comments | Indicates discussion velocity.      |
| ratio       | Float     | Upvote Ratio   | 0.00 to 1.00 (e.g., 0.94).          |
| updated\_at | Number    | Unix Timestamp | When this exact state was captured. |
| job\_id     | String    | UUID           | Traceability to the scheduler job.  |

Why separate Static and Dynamic?  
If we combined them, every update to score (which happens constantly) would require rewriting the title (which is static). In strict Redis terms, HSET only updates specific fields, but conceptually, keeping them separate allows us to set different Expiration Policies. For example, we might cache the Static data locally in the app state for longer, while always fetching Dynamic data fresh.

### **3.3 Partition 3: The Temporal Series (Time-Series Simulation)**

To support the "trend analysis" requirement, we must store the history of changes. Since Devvit lacks the Redis TimeSeries module, we simulate this using **Sorted Sets (ZSET)**.

Key Design: app:scope:post:{post\_id}:series:{metric}  
Data Structure: Redis Sorted Set  
The ZSET is the ideal primitive for time-series data in constrained environments because it inherently sorts data by a "Score."

* **The Score:** The Unix Timestamp (in seconds or milliseconds) of the snapshot.  
* **The Member:** The Value of the metric at that time.

Critical Implementation Detail:  
Redis ZSETs enforce unique members. If a post has a score of 105 at 10:00 AM, and 105 again at 10:15 AM, the second write would simply overwrite the score of the first, effectively deleting the 10:00 AM data point. This destroys the timeline.  
Solution: The Member must be composite to ensure uniqueness.

* **Format:** {value}:{timestamp}  
* **Example:** 105:1705490000

Querying the Series:  
To fetch the trend for the last 24 hours, the app uses ZRANGEBYSCORE:

TypeScript

`// Fetch data from (Now \- 24h) to (Now)  
const oneDayAgo \= Date.now() \- (24 \* 60 \* 60 \* 1000);  
const rawData \= await redis.zRangeByScore(key, oneDayAgo, Infinity);`

This is an $O(\log(N) + M)$ operation, which is highly efficient even for thousands of data points.

## ---

**4\. The Loading Table Pattern: Resilient Data Ingestion**

The request emphasizes handling snapshots via a "loading table." This is a sophisticated architectural pattern often used in Extract-Transform-Load (ETL) pipelines, adapted here for the micro-transactional world of Devvit.

### **4.1 The Necessity of Intermediate Staging**

Directly fetching data from the Reddit API and writing it to the normalized tables in a single synchronous block is risky.

1. **Complexity Risk:** The normalization logic (calculating deltas, updating word clouds) is computationally expensive. If the script times out halfway through, you might have updated the Static hash but not the Dynamic hash, leaving the database in an inconsistent state.  
2. **Inspection Capability:** If the app crashes, developers need to know *what* data caused the crash. Was the API response malformed? Was the post deleted?  
3. **Idempotency:** We may want to retry a failed processing job. If the data is only in memory, it is lost on crash. If it is in a Loading Table, we can retry.

### **4.2 The Loading Table Schema**

The Loading Table acts as a temporary holding pen.

Key Design: app:etl:loading:{job\_id}  
Data Structure: Redis Hash

| Field        | Description                                             |
|:------------ |:------------------------------------------------------- |
| payload      | The full, raw JSON string returned by the Reddit API.   |
| target\_id   | The Post ID (e.g., t3\_xyz).                            |
| state        | Current Status: PENDING, PROCESSING, COMPLETED, FAILED. |
| attempts     | Integer counter for retry logic.                        |
| ingested\_at | Timestamp of when the Scheduler fetched the data.       |

### **4.3 The Ingestion Lifecycle**

The lifecycle of a single data point follows a strict state machine:

1. **Phase 1: Fetch & Buffer (The Producer)**  
   * The Scheduled Job runs.  
   * It calls reddit.getPostById().  
   * It serializes the result and writes it to app:etl:loading:{uuid} with state PENDING.  
   * It pushes the {uuid} to a processing queue (a Redis List app:queue:processing).  
2. **Phase 2: Process & Normalize (The Consumer)**  
   * The processing logic (which can be in the same job execution or a subsequent trigger) pops the UUID.  
   * It performs an atomic state transition: HSET app:etl:loading:{uuid} state PROCESSING.  
   * It parses the payload JSON.  
   * It executes the Normalization logic (updating Static/Dynamic/Series keys).  
   * **Crucially**, it wraps the Redis writes in a MULTI transaction.  
3. **Phase 3: Cleanup (Garbage Collection)**  
   * Upon successful EXEC of the normalization transaction, the code deletes the loading key: DEL app:etl:loading:{uuid}.  
   * *Alternative:* To aid debugging, set a short TTL (Time-To-Live) instead of deleting immediately: EXPIRE app:etl:loading:{uuid} 3600 (1 hour). This allows developers to inspect recent snapshots if users report stats anomalies.

## ---

**5\. Automated Orchestration: The Scheduler Framework**

The Devvit Scheduler is the heartbeat of this system. It transforms a passive database into an active monitoring agent. The framework distinguishes between two types of automated tasks: **Recurring Monitors** and **Lifecycle Controllers**.

### **5.1 Recurring Jobs: The Pulse of Trend Analysis**

To generate a trend line (velocity), data must be sampled at regular, predictable intervals.

#### **5.1.1 Cron Strategy and Syntax**

Devvit supports standard UNIX Cron syntax.4 The framework uses this to define the resolution of the tracking.

* **High Resolution (The "Viral" Track):** \*/5 \* \* \* \* (Every 5 minutes). Used for posts that are currently flagged as "Hot" or "Rising."  
* **Standard Resolution:** \*/30 \* \* \* \* (Every 30 minutes). The default for regular active posts.  
* **Archival Resolution:** 0 \*/4 \* \* \* (Every 4 hours). For posts older than 24 hours but still technically active.

#### **5.1.2 Dynamic Scheduling Implementation**

Unlike static jobs defined in devvit.json (which run globally), tracking specific posts requires dynamic runtime scheduling.

TypeScript

`// Conceptual Implementation of Dynamic Scheduling  
const jobName \= 'snapshot\_worker';  
const scheduleDate \= new Date(); // Immediate or calculated future`

`const jobId \= await context.scheduler.runJob({  
    name: jobName,  
    cron: '\*/15 \* \* \* \*', // Every 15 minutes  
    data: {  
        postId: context.postId,  
        subredditId: context.subredditId  
    }  
});`

Persistence of Job IDs:  
A critical oversight in many implementations is failing to store the jobId. The scheduler returns an ID that is required to cancel the job later.5 If this ID is lost, the job becomes a "zombie"—running forever, consuming the scheduler quota, and bloating the database with stats for a post that was deleted months ago.

* **Requirement:** Store the mapping app:mapping:post\_to\_job:{post\_id} \-\> job\_id.

### **5.2 One-Off Jobs: Lifecycle Management**

One-off jobs are used for deterministic future actions, specifically **Self-Termination**.

#### **5.2.1 The "Time-Bomb" Pattern**

When tracking starts, we simultaneously schedule the "Start" (Recurring) and the "Stop" (One-Off).

1. **Action:** User clicks "Track Post."  
2. **System:** Starts recurring job (Job A).  
3. **System:** Schedules a One-Off job (Job B) for Date.now() \+ 24 Hours.  
4. **Future:** When Job B runs, its payload contains the ID of Job A. Job B calls scheduler.cancelJob(JobA\_ID).

This guarantees that no tracking session lasts longer than 24 hours (or the defined window) without manual intervention, preventing runaway resource usage.

### **5.3 Failure Modes and Drift**

Cron jobs in distributed systems are not real-time guarantees. A job scheduled for 12:00:00 might run at 12:00:05.

* **Implication for Stats:** When calculating "Velocity" (Votes per Minute), one cannot assume the delta is exactly 15 minutes.  

* Solution: Always use the timestamp stored in the Dynamic Hash (actual execution time) rather than the scheduled time.
  
  ${Velocity} = \frac{Votes_{new} - Votes_{old}}{Time_{new} - Time_{old}}$
  
  Using the actual timestamps ensures mathematical accuracy even if the scheduler drifts by seconds or minutes.

## ---

**6\. Analytical Engine: Trend Analysis Logic**

With normalized data flowing into Redis ZSETs, the system can perform advanced analysis. The requirement is to support "Trend Analysis," which we decompose into **Velocity**, **Acceleration**, and **Anomaly Detection**.

### **6.1 Velocity (The First Derivative)**

Velocity measures the speed of engagement.

* **Metric:** Upvotes per Minute (UPM).  
* **Calculation:**  
  1. Fetch the last 2 snapshots from post:{id}:series.  
  2. Calculate $\\Delta Score$ and $\\Delta Time$ (in minutes).  
  3. $UPM = \frac{DeltaScore}{DeltaTime}$.

**Insight Application:** This metric drives "Rising" badges. If $UPM \> Threshold$, the post is visually highlighted in the UI.

### **6.2 Acceleration (The Second Derivative)**

Acceleration measures the *change* in velocity. This is the key predictor of "Viral" content.

* **Metric:** $\\Delta UPM$ per Minute.  
* **Logic:**  
  1. Calculate Velocity for the most recent window ($V_1$).  
  2. Calculate Velocity for the previous window ($V_0$).  
  3. If $V_1 \gt V_0 \times 1.5$ (50% increase), the post is accelerating.

**Insight Application:** Acceleration triggers notifications. "This post is taking off\!" alerts are generated only when acceleration is positive and significant.

### **6.3 Moving Averages (Smoothing)**

Raw snapshot data is noisy. A single "glitch" or a momentary burst of downvotes can skew velocity. The framework implements a **Simple Moving Average (SMA)**.

* **Window:** 1 Hour (4 snapshots at 15-min intervals).  
* **Calculation:** Sum the scores of the last 4 snapshots, divide by 4\.  
* **Redis Implementation:** ZRANGE with negative indices (-4, \-1) efficiently retrieves the exact window needed for SMA calculation.

## ---

**7\. Semantic Analysis: Word Cloud Generation via Redis**

The requirement to investigate Redis for word cloud generation presents a significant challenge due to the lack of the RediSearch module.1 We must reimplement the "Term Frequency" algorithm using basic Redis primitives.

### **7.1 The Tokenization Pipeline (Application Layer)**

Since Redis cannot parse text, the Devvit application must perform tokenization. This involves:

1. **Fetching Content:** Reading post.title and post.selftext.  
2. **Sanitization:** converting to lowercase, removing punctuation via Regex (/\[^\\w\\s\]/g).  
3. **Stopword Filtering:** This is critical. Common words ("the", "is", "reddit") overwhelm the frequency count, making the cloud useless.  
   * **Implementation:** We include a hardcoded set of stopwords in the application bundle.8 This set is checked in $O(1)$ time for every token.  
   * *Note:* We avoid loading external libraries to keep the bundle size small, utilizing a compact list of the top 100 English stopwords.

### **7.2 The Storage Engine: Global vs. Local ZSETs**

We utilize Redis Sorted Sets (ZSET) to store term frequencies. The Score represents the frequency (count) of the word.

#### **7.2.1 Per-Post Cloud**

* **Key:** app:stats:cloud:{post\_id}  
* **Use Case:** Showing the themes of a specific discussion.

#### **7.2.2 Global Subreddit Cloud**

* **Key:** app:stats:cloud:global  
* **Use Case:** "What is r/Technology talking about today?"

### **7.3 The Increment Logic**

For every snapshot, we identify *new* content (e.g., new comments or body edits). For simplicity in this framework, we focus on the Post Body.

TypeScript

// Conceptual Logic  
const tokens \= tokenize(postText);  
const tx \= redis.multi();

tokens.forEach(token \=\> {  
    // ZINCRBY: If word exists, increment score. If not, add with score 1\.  
    tx.zIncrBy('app:stats:cloud:global', 1, token);  
});

await tx.exec();

### **7.4 Pruning and Optimization (Zipf's Law)**

Zipf's law states that a few words occur very frequently, while many words occur rarely. The "Long Tail" of rare words consumes vast amounts of storage (tens of thousands of keys) for little value.

Optimization Strategy:  
To protect the 500 MB limit, we enforce a Cardinality Cap.

1. **The Cap:** Keep only the top 1,000 words.  
2. **The Pruner:** A daily job runs ZREMRANGEBYRANK app:stats:cloud:global 0 \-1001.  
   * This command sorts the set by score (frequency) and removes everything *except* the top 1000 items (indices \-1001 to \-1).  
   * This guarantees that the Word Cloud storage never exceeds a fixed size, regardless of how much text is analyzed.

## ---

**8\. Operational Resilience and Future-Proofing**

### **8.1 Handling the 500 MB Ceiling**

The 500 MB limit is the ultimate constraint. The framework employs a **Least Recently Used (LRU) Simulation** for data retention.

* **TTL Strategy:** While we want permanent stats, we cannot keep them forever.  
  * **Loading Table:** 1 Hour TTL.  
  * **Dynamic/Static Keys:** 6 Months TTL (refreshed on access).  
  * **Series Data:** 30 Days.  
* **Panic Button:** The app should monitor the used\_memory (if accessible via INFO, otherwise roughly by key count). If storage approaches 90%, a "Panic Job" is triggered to aggressively prune history (reducing Series retention from 30 days to 7 days).

### **8.2 Optimistic Locking for Data Integrity**

In the highly concurrent environment of a popular subreddit, race conditions are inevitable.

* **Scenario:** A moderator updates a post's flair (triggering a Static update) at the exact same moment the Scheduler runs a Snapshot (triggering a Static check).  

* **Defense:**  
  TypeScript  
  await redis.watch(staticKey);  
  const exists \= await redis.get(staticKey);  
  const tx \= redis.multi();  
  if (\!exists) { tx.hSet(...) }  
  const result \= await tx.exec();
  
  If result is null, it means the key changed while we were watching. The framework catches this and simply aborts (assuming the other process succeeded) or retries. This ensures we never accidentally overwrite a newer update with stale data.

## ---

**9\. Conclusion**

The architectural framework presented herein offers a definitive path to implementing robust statistical tracking on Reddit Devvit. By embracing **Normalization**, the system maximizes the utility of the restricted 500 MB storage quota. By utilizing the **Loading Table Pattern**, it ensures resilient and idempotent data ingestion. The sophisticated use of the **Scheduler** allows for hands-off, automated monitoring that scales with community activity. Finally, the novel application of **Redis ZSETs** for semantic analysis proves that rich features like word clouds can be achieved without heavy external dependencies. This framework transforms the constraints of the Devvit platform into design parameters, resulting in a system that is efficient, scalable, and deeply integrated into the Reddit ecosystem.

#### **Works cited**

1. Redis \- Reddit for Developers, accessed January 17, 2026, [https://developers.reddit.com/docs/capabilities/server/redis](https://developers.reddit.com/docs/capabilities/server/redis)  
2. Redis | Reddit for Developers, accessed January 17, 2026, [https://developers.reddit.com/docs/0.11/capabilities/redis](https://developers.reddit.com/docs/0.11/capabilities/redis)  
3. Redis Transactions Made Easy: MULTI, EXEC, DISCARD, and WATCH \- DEV Community, accessed January 17, 2026, [https://dev.to/rijultp/redis-transactions-made-easy-multi-exec-discard-and-watch-325m](https://dev.to/rijultp/redis-transactions-made-easy-multi-exec-discard-and-watch-325m)  
4. devvit.json \- Configure Your App \- Reddit for Developers, accessed January 17, 2026, [https://developers.reddit.com/docs/capabilities/devvit-web/devvit\_web\_configuration](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration)  
5. Scheduler \- Reddit for Developers, accessed January 17, 2026, [https://developers.reddit.com/docs/capabilities/server/scheduler](https://developers.reddit.com/docs/capabilities/server/scheduler)  
6. Scheduler \- Reddit for Developers, accessed January 17, 2026, [https://developers.reddit.com/docs/0.11/capabilities/scheduler](https://developers.reddit.com/docs/0.11/capabilities/scheduler)  
7. RediSearch/RediSearch: A query and indexing engine for Redis, providing secondary indexing, full-text search, vector similarity search and aggregations. \- GitHub, accessed January 17, 2026, [https://github.com/RediSearch/RediSearch](https://github.com/RediSearch/RediSearch)  
8. NLTK's list of english stopwords \- GitHub Gist, accessed January 17, 2026, [https://gist.github.com/sebleier/554280](https://gist.github.com/sebleier/554280)  
9. JavaScript Basics 10b. Remove stopwords. | by Practicing DatScy \- Medium, accessed January 17, 2026, [https://medium.com/@j622amilah/javascript-basics-10b-14f5be91cfbc](https://medium.com/@j622amilah/javascript-basics-10b-14f5be91cfbc)