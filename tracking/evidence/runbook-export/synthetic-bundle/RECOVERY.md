# When something fails

Use this whenever a gate does not pass, a step cannot be finished, or the bundle and reality disagree.

1. **Stop at the failing step.** Do not start a later prompt; its prerequisites are not met.
2. **Read the failure exactly.** Keep the command, its output and the check key (for example A2). Do not guess from memory.
3. **Repair inside the task’s scope.** Change only the files the task may change. If the fix needs another file, the task plan is wrong: stop and ask the owner.
4. **Run the same check again**, then every check that passed before. A fix that breaks an earlier check is not a fix.
5. **After three failed repairs of the same check, stop.** Report the check, the three attempts and their output to the owner.
6. **Never change a requirement, an acceptance check or its expected output to get a pass.** They are fixed in this bundle. If one looks wrong, say so in your report and leave it as it is.
7. **If the bundle is missing something you need** (a decision, data, an account, a credential), do not invent it. List it as a blocker. Nothing in this bundle grants access to anything.
8. **If the workspace is broken** (lost files, a bad merge), return to the last commit whose gate passed and replay the prompts after it.

A report of a failure is a good result. A pass that was not observed is not.
