// Shell output sanitizer unit tests (pure, no pi runtime needed).
const { sanitizeShellOutput } = await import("../packages/core/shell-output.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. Plain text passes through untouched
check("plain text untouched", sanitizeShellOutput("hello world") === "hello world");
check("empty string", sanitizeShellOutput("") === "");
check("non-string returns empty", sanitizeShellOutput(null) === "" && sanitizeShellOutput(42) === "");

// 2. CSI: colors, cursor moves, private modes (alt screen, hide cursor)
check("SGR color stripped", sanitizeShellOutput("\x1b[31mred\x1b[0m") === "red");
check("cursor move stripped", sanitizeShellOutput("a\x1b[2Ab") === "ab");
check("alt screen stripped", sanitizeShellOutput("x\x1b[?1049hy\x1b[?1049lz") === "xyz");
check("erase-in-line stripped", sanitizeShellOutput("spin\x1b[Kner") === "spinner");

// 3. OSC: window titles (BEL- and ST-terminated), hyperlinks
check("OSC title (BEL) stripped", sanitizeShellOutput("\x1b]0;my title\x07rest") === "rest");
check("OSC title (ST) stripped", sanitizeShellOutput("\x1b]0;my title\x1b\\rest") === "rest");
check("OSC 8 hyperlink stripped", sanitizeShellOutput("\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\") === "link");

// 4. Single ESC sequences: save/restore cursor, full reset, charset select
check("ESC 7/8 stripped", sanitizeShellOutput("a\x1b7b\x1b8c") === "abc");
check("ESC c (reset) stripped", sanitizeShellOutput("a\x1bcb") === "ab");

// 5. C0 controls: BEL, BS, CR, NUL stripped; \n and \t kept
check("BEL stripped", sanitizeShellOutput("ding\x07!") === "ding!");
check("backspace stripped", sanitizeShellOutput("ab\bc") === "abc");
check("carriage return stripped", sanitizeShellOutput("car\rret") === "carret");
check("NUL stripped", sanitizeShellOutput("a\x00b") === "ab");
check("tab kept", sanitizeShellOutput("a\tb") === "a\tb");
check("newline kept", sanitizeShellOutput("a\nb") === "a\nb");

// 6. Pathological input never throws (lone ESC at end, unterminated OSC)
check("lone trailing ESC", sanitizeShellOutput("trail\x1b") === "trail");
check("unterminated OSC handled", typeof sanitizeShellOutput("\x1b]0;never closed") === "string");

// 7. Realistic mixed payload (spinner frames + progress bar + colors)
const messy = "\x1b[2K\r\x1b[32m✓\x1b[0m done 100%\x07";
check("mixed payload", sanitizeShellOutput(messy) === "✓ done 100%");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
