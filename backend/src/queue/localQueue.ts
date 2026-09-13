// Local request queue for single concurrency with Ollama
// This prevents resource contention and ensures predictable performance

interface QueuedTask<T> {
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

class LocalQueue {
  private queue: QueuedTask<any>[] = [];
  private processing = false;

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        execute: fn,
        resolve,
        reject
      });

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;

      try {
        const result = await task.execute();
        task.resolve(result);
      } catch (error) {
        task.reject(error);
      }
    }

    this.processing = false;
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}

// Singleton instance for local Ollama requests
const localQueue = new LocalQueue();

export async function enqueueLocal<T>(fn: () => Promise<T>): Promise<T> {
  return localQueue.enqueue(fn);
}

export function getLocalQueueStatus() {
  return {
    queueSize: localQueue.getQueueSize(),
    processing: localQueue.isProcessing()
  };
}