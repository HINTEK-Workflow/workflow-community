import assert from "node:assert/strict";
import test from "node:test";
import { formatProgramLines, insertProgramSnippet, parseProgramText, TEXT_SNIPPETS } from "../lib/self-inspection/text";

// The self-inspection ribbon (2026-10-07): Rubrik, Stycke, Punktlista and Numrerad lista format the lines under
// the cursor in the programme's plain text, and the same button again turns them back into paragraphs.
test("the ribbon formats the lines the selection touches", () => {
  const text = "Inledning\nFörsta\nAndra\nSlut";
  const first = text.indexOf("Första");
  const bullets = formatProgramLines(text, first + 2, text.indexOf("Andra") + 1, "bullets");
  assert.equal(bullets.text, "Inledning\n- Första\n- Andra\nSlut");
  assert.equal(bullets.text.slice(bullets.start, bullets.end), "- Första\n- Andra");
  const numbered = formatProgramLines(bullets.text, bullets.start, bullets.end, "numbered");
  assert.equal(numbered.text, "Inledning\n1. Första\n2. Andra\nSlut");
  const back = formatProgramLines(numbered.text, numbered.start, numbered.end, "numbered");
  assert.equal(back.text, text, "the same button again makes paragraphs");
  const heading = formatProgramLines(text, 0, 0, "heading");
  assert.equal(heading.text, "## Inledning\nFörsta\nAndra\nSlut");
  assert.deepEqual(parseProgramText(heading.text)[0], { type: "heading", text: "Inledning" });
  assert.equal(formatProgramLines(heading.text, 3, 3, "paragraph").text, text);
});

test("an empty line gets the snippet, and a table lands on lines of its own", () => {
  const empty = formatProgramLines("Text\n\nMer", 5, 5, "bullets");
  assert.equal(empty.text, `Text\n${TEXT_SNIPPETS.bullets}\nMer`);
  assert.equal(empty.text.slice(empty.start, empty.end), TEXT_SNIPPETS.bullets);
  const table = insertProgramSnippet("Före\nEfter", 2, TEXT_SNIPPETS.table);
  assert.equal(table.text, `Före\n${TEXT_SNIPPETS.table}\nEfter`);
  assert.equal(parseProgramText(table.text)[1].type, "table");
  assert.equal(insertProgramSnippet("", 0, "## Rubrik").text, "## Rubrik");
});
