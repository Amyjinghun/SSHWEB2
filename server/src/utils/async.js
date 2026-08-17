// 有限并发执行：结果顺序与输入一致；单个任务抛错记为 { ok:false, error }，不中断其他任务
async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { ok: false, error: err.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

module.exports = { runWithConcurrency };
