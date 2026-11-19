import type { Lang } from './types';

export interface Example {
  title: string;
  lang: Lang;
  code: string;
  stdin?: string;
}

export const examples: Example[] = [
  {
    title: 'Two Sum (hash map) + edge cases',
    lang: 'python',
    code: `def two_sum(nums, target):
    seen = {}                     # value -> index
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return [seen[need], i]
        seen[x] = i
    return []                     # edge case: no pair

print(two_sum([4, -3, 7, 11, -8], -11))   # negatives
print(two_sum([3, 3], 6))                 # duplicates
print(two_sum([1, 2], 10))                # no answer
`,
  },
  {
    title: 'Binary search (missing / empty)',
    lang: 'python',
    code: `def binary_search(arr, target):
    lo, hi = 0, len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

nums = [-15, -7, -2, 0, 3, 9, 14]
print(binary_search(nums, -7))
print(binary_search(nums, 5))    # not present
print(binary_search([], 1))      # empty list
`,
  },
  {
    title: 'Bubble sort with negatives',
    lang: 'python',
    code: `def bubble_sort(a):
    n = len(a)
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            if a[j] > a[j + 1]:
                a[j], a[j + 1] = a[j + 1], a[j]
                swapped = True
        if not swapped:          # already sorted -> stop early
            break
    return a

print(bubble_sort([5, -2, 9, 0, -7, 3]))
`,
  },
  {
    title: 'Fibonacci with memo (recursion)',
    lang: 'python',
    code: `def fib(n, memo):
    if n <= 1:                   # base cases: fib(0)=0, fib(1)=1
        return n
    if n in memo:
        return memo[n]
    memo[n] = fib(n - 1, memo) + fib(n - 2, memo)
    return memo[n]

print(fib(6, {}))
`,
  },
  {
    title: "Kadane's max subarray (all negative)",
    lang: 'python',
    code: `def max_subarray(nums):
    if not nums:
        return None              # edge case: empty input
    best = cur = nums[0]         # NOT 0 -- handles all-negative input
    for x in nums[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best

print(max_subarray([-2, 1, -3, 4, -1, 2, 1, -5, 4]))
print(max_subarray([-8, -3, -6, -2]))
print(max_subarray([]))
`,
  },
  {
    title: 'Coin change DP (impossible amount)',
    lang: 'python',
    code: `def coin_change(coins, amount):
    INF = float('inf')
    dp = [0] + [INF] * amount
    for x in range(1, amount + 1):
        for c in coins:
            if c <= x and dp[x - c] + 1 < dp[x]:
                dp[x] = dp[x - c] + 1
    return dp[amount] if dp[amount] != INF else -1

print(coin_change([1, 3, 4], 6))
print(coin_change([2], 3))       # impossible -> -1
`,
  },
  {
    title: 'BFS shortest path on a grid',
    lang: 'python',
    code: `from collections import deque

def shortest(grid):
    R, C = len(grid), len(grid[0])
    if grid[0][0] == 1:
        return -1                # start is a wall
    dist = [[-1] * C for _ in range(R)]
    dist[0][0] = 0
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == 0 and dist[nr][nc] == -1:
                dist[nr][nc] = dist[r][c] + 1
                q.append((nr, nc))
    return dist[R - 1][C - 1]

print(shortest([[0, 0, 1], [1, 0, 0], [0, 0, 0]]))
`,
  },
  {
    title: 'Reverse a linked list (classes)',
    lang: 'python',
    code: `class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

def reverse(head):
    prev = None
    cur = head
    while cur:
        nxt = cur.next
        cur.next = prev
        prev = cur
        cur = nxt
    return prev

head = Node(1, Node(2, Node(3)))
head = reverse(head)
print(head.val, head.next.val, head.next.next.val)
print(reverse(None))             # edge case: empty list
`,
  },
  {
    title: 'Read input (stdin)',
    lang: 'python',
    stdin: '6\n3 -1 4 -1 5 -9',
    code: `n = int(input())
nums = list(map(int, input().split()))
total = 0
negatives = 0
for x in nums:
    if x < 0:
        negatives += 1
        continue
    total += x
print("sum of non-negatives:", total)
print("negatives skipped:", negatives)
`,
  },
  {
    title: 'Two Sum (JavaScript)',
    lang: 'javascript',
    code: `function twoSum(nums, target) {
  const seen = new Map();          // value -> index
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];                       // edge case: no pair
}

console.log(twoSum([4, -3, 7, 11, -8], -11));
console.log(twoSum([1, 2], 10));
`,
  },
  {
    title: 'Merge sort (JavaScript recursion)',
    lang: 'javascript',
    code: `function mergeSort(a) {
  if (a.length <= 1) return a;     // base case (also handles [])
  const mid = Math.floor(a.length / 2);
  const left = mergeSort(a.slice(0, mid));
  const right = mergeSort(a.slice(mid));
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++]);
    else out.push(right[j++]);
  }
  return out.concat(left.slice(i), right.slice(j));
}

console.log(mergeSort([5, -1, 3, -8, 2]));
`,
  },
  {
    title: 'Stack: valid parentheses (JavaScript)',
    lang: 'javascript',
    code: `function isValid(s) {
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (const ch of s) {
    if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return false;
    } else {
      stack.push(ch);
    }
  }
  return stack.length === 0;
}

console.log(isValid("([]{})"));
console.log(isValid("(]"));
console.log(isValid(""));          // edge case: empty string
`,
  },
  {
    title: 'Read input (JavaScript stdin)',
    lang: 'javascript',
    stdin: '5\n-4 8 -15 16 23',
    code: `const data = require('fs').readFileSync(0, 'utf8').trim().split('\\n');
const n = Number(data[0]);
const nums = data[1].split(' ').map(Number);
let min = Infinity, max = -Infinity;
for (const x of nums) {
  if (x < min) min = x;
  if (x > max) max = x;
}
console.log(n, 'numbers, min', min, 'max', max);
`,
  },
];

export const defaultExample = (lang: Lang) => examples.find((e) => e.lang === lang)!;
