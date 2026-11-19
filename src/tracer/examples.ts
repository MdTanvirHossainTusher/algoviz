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
  // ---------------- C++ ----------------
  {
    title: 'Two Sum with unordered_map (C++)',
    lang: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

vector<int> twoSum(vector<int>& nums, int target) {
    unordered_map<int, int> seen;          // value -> index
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        if (seen.count(need)) return {seen[need], i};
        seen[nums[i]] = i;
    }
    return {};                              // edge case: no pair
}

int main() {
    vector<int> a = {4, -3, 7, 11, -8};
    vector<int> r = twoSum(a, -11);         // negatives
    cout << r[0] << " " << r[1] << endl;
    vector<int> b = {3, 3};
    r = twoSum(b, 6);                       // duplicates
    cout << r[0] << " " << r[1] << endl;
    vector<int> c = {1, 2};
    cout << twoSum(c, 10).size() << endl;   // no answer
    return 0;
}
`,
  },
  {
    title: 'Binary search: missing, empty, negatives (C++)',
    lang: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

int binarySearch(const vector<int>& a, int target) {
    int lo = 0, hi = (int)a.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;       // avoids overflow
        if (a[mid] == target) return mid;
        if (a[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}

int main() {
    vector<int> nums = {-15, -7, -2, 0, 3, 9, 14};
    cout << binarySearch(nums, -7) << endl;
    cout << binarySearch(nums, 5) << endl;    // not present
    cout << binarySearch({}, 1) << endl;      // empty
    // the standard library does the same:
    auto it = lower_bound(nums.begin(), nums.end(), 4);
    cout << "lower_bound(4) at index " << (it - nums.begin()) << endl;
}
`,
  },
  {
    title: 'Reverse a linked list (pointers, C++)',
    lang: 'cpp',
    code: `#include <iostream>
using namespace std;

struct Node {
    int val;
    Node* next;
    Node(int v) : val(v), next(nullptr) {}
};

Node* reverse(Node* head) {
    Node* prev = nullptr;
    while (head != nullptr) {
        Node* nxt = head->next;
        head->next = prev;
        prev = head;
        head = nxt;
    }
    return prev;
}

int main() {
    Node* head = new Node(1);
    head->next = new Node(-2);
    head->next->next = new Node(3);
    head = reverse(head);
    for (Node* p = head; p; p = p->next) cout << p->val << " ";
    cout << endl;
    cout << (reverse(nullptr) == nullptr) << endl;   // empty list
}
`,
  },
  {
    title: 'Dijkstra with a priority_queue (C++)',
    lang: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n = 5;
    vector<vector<pair<int, int>>> adj(n);   // node -> (neighbor, weight)
    auto edge = [&](int u, int v, int w) { adj[u].push_back({v, w}); adj[v].push_back({u, w}); };
    edge(0, 1, 4); edge(0, 2, 1); edge(2, 1, 2); edge(1, 3, 5);
    // node 4 is unreachable (edge case)

    vector<int> dist(n, INT_MAX);
    priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> pq;
    dist[0] = 0;
    pq.push({0, 0});
    while (!pq.empty()) {
        auto [d, u] = pq.top();
        pq.pop();
        if (d > dist[u]) continue;           // stale entry
        for (auto [v, w] : adj[u]) {
            if (dist[u] + w < dist[v]) {
                dist[v] = dist[u] + w;
                pq.push({dist[v], v});
            }
        }
    }
    for (int i = 0; i < n; i++) cout << i << ": " << (dist[i] == INT_MAX ? -1 : dist[i]) << endl;
}
`,
  },
  {
    title: 'Coin change DP + impossible amount (C++)',
    lang: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

int coinChange(vector<int>& coins, int amount) {
    vector<int> dp(amount + 1, INT_MAX);
    dp[0] = 0;
    for (int x = 1; x <= amount; x++)
        for (int c : coins)
            if (c <= x && dp[x - c] != INT_MAX)
                dp[x] = min(dp[x], dp[x - c] + 1);
    return dp[amount] == INT_MAX ? -1 : dp[amount];
}

int main() {
    vector<int> coins = {1, 3, 4};
    cout << coinChange(coins, 6) << endl;   // 3 + 3
    vector<int> evens = {2};
    cout << coinChange(evens, 3) << endl;   // impossible
    cout << coinChange(coins, 0) << endl;   // zero amount
}
`,
  },
  {
    title: 'Read input with cin (C++)',
    lang: 'cpp',
    stdin: '5\n-4 8 -15 16 23',
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    vector<long long> a(n);
    for (auto& x : a) cin >> x;
    long long sum = 0, best = LLONG_MIN;
    for (long long x : a) {
        sum += x;
        best = max(best, x);
    }
    cout << "sum " << sum << ", max " << best << endl;
    sort(a.begin(), a.end());
    for (long long x : a) cout << x << ' ';
    cout << '\\n';
}
`,
  },
  // ---------------- Java ----------------
  {
    title: 'Two Sum with HashMap (Java)',
    lang: 'java',
    code: `import java.util.*;

public class Main {
    static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();   // value -> index
        for (int i = 0; i < nums.length; i++) {
            int need = target - nums[i];
            if (seen.containsKey(need)) return new int[]{seen.get(need), i};
            seen.put(nums[i], i);
        }
        return new int[0];                               // edge case: no pair
    }

    public static void main(String[] args) {
        System.out.println(Arrays.toString(twoSum(new int[]{4, -3, 7, 11, -8}, -11)));
        System.out.println(Arrays.toString(twoSum(new int[]{3, 3}, 6)));
        System.out.println(Arrays.toString(twoSum(new int[]{1, 2}, 10)));
    }
}
`,
  },
  {
    title: 'BFS shortest path on a grid (Java)',
    lang: 'java',
    code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        char[][] grid = {
            "S.#".toCharArray(),
            ".##".toCharArray(),
            "..E".toCharArray(),
        };
        int rows = grid.length, cols = grid[0].length;
        int[][] dist = new int[rows][cols];
        for (int[] row : dist) Arrays.fill(row, -1);
        Deque<int[]> queue = new ArrayDeque<>();
        queue.offer(new int[]{0, 0});
        dist[0][0] = 0;
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        while (!queue.isEmpty()) {
            int[] cur = queue.poll();
            for (int[] d : dirs) {
                int r = cur[0] + d[0], c = cur[1] + d[1];
                if (r < 0 || c < 0 || r >= rows || c >= cols) continue;   // off the grid
                if (grid[r][c] == '#' || dist[r][c] != -1) continue;      // wall / seen
                dist[r][c] = dist[cur[0]][cur[1]] + 1;
                queue.offer(new int[]{r, c});
            }
        }
        System.out.println("steps to E: " + dist[2][2]);
        System.out.println("unreachable cell: " + dist[0][2]);
    }
}
`,
  },
  {
    title: 'Binary search tree insert + inorder (Java)',
    lang: 'java',
    code: `import java.util.*;

public class Main {
    static class Node {
        int val;
        Node left, right;
        Node(int v) { val = v; }
    }

    static Node insert(Node root, int v) {
        if (root == null) return new Node(v);
        if (v < root.val) root.left = insert(root.left, v);
        else root.right = insert(root.right, v);
        return root;
    }

    static void inorder(Node n, List<Integer> out) {
        if (n == null) return;
        inorder(n.left, out);
        out.add(n.val);
        inorder(n.right, out);
    }

    public static void main(String[] args) {
        Node root = null;
        for (int v : new int[]{5, -3, 8, 0, -7}) root = insert(root, v);
        List<Integer> out = new ArrayList<>();
        inorder(root, out);
        System.out.println(out);   // sorted, negatives first
    }
}
`,
  },
  {
    title: 'Sort objects with a Comparator (Java)',
    lang: 'java',
    code: `import java.util.*;

public class Main {
    static class Interval {
        int start, end;
        Interval(int s, int e) { start = s; end = e; }
        public String toString() { return "[" + start + "," + end + "]"; }
    }

    public static void main(String[] args) {
        List<Interval> list = new ArrayList<>();
        list.add(new Interval(8, 10));
        list.add(new Interval(-2, 3));
        list.add(new Interval(1, 6));
        list.add(new Interval(-5, -4));
        list.sort((a, b) -> a.start - b.start);
        List<Interval> merged = new ArrayList<>();
        for (Interval cur : list) {
            Interval last = merged.isEmpty() ? null : merged.get(merged.size() - 1);
            if (last == null || last.end < cur.start) merged.add(cur);
            else last.end = Math.max(last.end, cur.end);
        }
        System.out.println(merged);
    }
}
`,
  },
  {
    title: 'Read input with Scanner (Java)',
    lang: 'java',
    stdin: '5\n-4 8 -15 16 23',
    code: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) a[i] = sc.nextInt();
        long sum = 0;
        int max = Integer.MIN_VALUE;
        for (int x : a) {
            sum += x;
            max = Math.max(max, x);
        }
        System.out.println("sum " + sum + ", max " + max);
        Arrays.sort(a);
        System.out.println(Arrays.toString(a));
    }
}
`,
  },
];

export const defaultExample = (lang: Lang) => examples.find((e) => e.lang === lang)!;
