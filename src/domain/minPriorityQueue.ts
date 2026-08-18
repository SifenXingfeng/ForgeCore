export interface PriorityQueueEntry<T> {
  value: T
  priority: number
  secondary: number
  key: string
}

const compareEntries = <T>(left: PriorityQueueEntry<T>, right: PriorityQueueEntry<T>): number => {
  const priorityDifference = left.priority - right.priority
  if (Math.abs(priorityDifference) > 1e-9) return priorityDifference
  const secondaryDifference = left.secondary - right.secondary
  if (Math.abs(secondaryDifference) > 1e-9) return secondaryDifference
  return left.key.localeCompare(right.key)
}

/** Deterministic binary min-heap used by the AGV and drone A* planners. */
export class MinPriorityQueue<T> {
  private readonly heap: Array<PriorityQueueEntry<T>> = []

  get size(): number {
    return this.heap.length
  }

  push(entry: PriorityQueueEntry<T>): void {
    this.heap.push(entry)
    let index = this.heap.length - 1
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (compareEntries(this.heap[parentIndex], entry) <= 0) break
      this.heap[index] = this.heap[parentIndex]
      index = parentIndex
    }
    this.heap[index] = entry
  }

  pop(): PriorityQueueEntry<T> | null {
    const first = this.heap[0]
    const last = this.heap.pop()
    if (!first || !last) return first ?? null
    if (this.heap.length === 0) return first

    let index = 0
    while (true) {
      const leftIndex = index * 2 + 1
      const rightIndex = leftIndex + 1
      if (leftIndex >= this.heap.length) break
      let childIndex = leftIndex
      if (rightIndex < this.heap.length && compareEntries(this.heap[rightIndex], this.heap[leftIndex]) < 0) childIndex = rightIndex
      if (compareEntries(last, this.heap[childIndex]) <= 0) break
      this.heap[index] = this.heap[childIndex]
      index = childIndex
    }
    this.heap[index] = last
    return first
  }
}
