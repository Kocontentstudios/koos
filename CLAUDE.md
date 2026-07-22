# CODE COMMENTING NORMS & RESTRAINTS

- NO REDUNDANT "WHAT" COMMENTS: Do not write comments that describe what the code does (e.g., do not add `// loop through array` or `// fetch user data`). The code must be self-documenting through clear naming.
- ONLY "WHY" COMMENTS: Only write comments to explain non-obvious business logic, unidiomatic workarounds, or critical edge cases.
- DO NOT PRESERVE OLD CODE: Never comment out old or replaced blocks of code. Delete them completely; rely entirely on Git version control.
- MAXIMISE TOKEN EFFICIENCY: Treat inline comments as an expensive token cost. If you can express the intent using an explicit variable or function name, do that instead of adding a comment.
- ENFORCE CLEAN REFACTORING: If a section requires extensive explanation, refactor it into smaller, descriptive, single-responsibility functions rather than keeping the complex code and adding heavy comments.
