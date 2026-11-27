import assert from "node:assert/strict";
import { test } from "node:test";
import { clearReturnDraft, draftAddress, readReturnDraft, registerReturnDraft, saveReturnDrafts } from "../lib/workflow/return-draft";

const store = new Map<string, string>();
Object.assign(globalThis, { sessionStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } } });

test("the address of a form is the same before the trip and after the return (pickCustomer left out)", () => {
  assert.equal(draftAddress("/?view=new_project&pickCustomer=abc"), "/?view=new_project");
  assert.equal(draftAddress("/?view=new_project"), "/?view=new_project");
  assert.equal(draftAddress("/?view=project&projectId=p1&edit=1&pickCustomer=x"), "/?view=project&projectId=p1&edit=1");
});

test("registered forms are saved for the address and read back once", () => {
  const unregister = registerReturnDraft("project", () => ({ name: "Utkast", fields: { client: "A" } }));
  saveReturnDrafts("/?view=new_project");
  unregister();
  assert.deepEqual(readReturnDraft("project", "/?view=new_project&pickCustomer=k"), { name: "Utkast", fields: { client: "A" } });
  assert.equal(readReturnDraft("project", "/?view=other"), null, "another address has none");
  clearReturnDraft("project", "/?view=new_project");
  assert.equal(readReturnDraft("project", "/?view=new_project"), null, "gone once used");
});
