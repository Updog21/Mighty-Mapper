# Code Refactor Review Report

Date: Monday 12 January 2026

## 🛡️ Code Hardening (Security & Robustness)

1.  **Input Sanitization for AI Output (`validation-service.ts`)**
    *   **Issue:** `GeminiProvider` relies on `JSON.parse(text)` directly on the AI's response. LLMs can occasionally return markdown formatting or malformed JSON.
    *   **Recommendation:** Wrap parsing in a "repair" function and validate the shape using Zod before returning.

2.  **Unmanaged Background Promises (`product-service.ts`)**
    *   **Issue:** `createProduct` calls `runAutoMapper` without awaiting it. Unhandled rejections could crash the process or be lost.
    *   **Recommendation:** Wrap background calls in a utility that ensures safe error handling and structured logging.

3.  **Shell Execution Safety (`admin-service.ts`)**
    *   **Issue:** `execAsync` invokes a shell. While currently hardcoded, this is a potential vector for Command Injection.
    *   **Recommendation:** Switch from `exec` to `spawn` to pass arguments as an array, bypassing the shell.

4.  **Parallel Execution with Concurrency Limits (`auto-mapper/service.ts`)**
    *   **Issue:** `runAutoMapper` iterates through adapters (Sigma, Splunk, etc.) **serially**, causing performance bottlenecks.
    *   **Recommendation:** Use `Promise.allSettled` to run adapter fetches in parallel.

---

## 🧹 Code Cleanup (Housekeeping)

5.  **Type Safety Improvements**
    *   **Issue:** Usage of `any` in `GeminiProvider` and `runAutoMapper`.
    *   **Recommendation:** Define proper interfaces and union types instead of `any`.

6.  **Magic Numbers & Constants**
    *   **Issue:** Hardcoded batch limit of `5` in `validateAnalytics`.
    *   **Recommendation:** Extract to a constant `MAX_AI_VALIDATION_BATCH_SIZE`.

7.  **DRY (Don't Repeat Yourself) SQL Logic**
    *   **Issue:** `ProductService.searchProducts` duplicates SQL logic for name/vendor matching.
    *   **Recommendation:** Refactor common SQL fragments into reusable variables.

8.  **Strict Path Resolution**
    *   **Issue:** `AdminService` uses relative paths (`./data/sigma`), which are CWD-dependent.
    *   **Recommendation:** Use `path.resolve` with `__dirname` to ensure absolute path stability.
