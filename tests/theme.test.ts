import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { extractLogoPrimary } from "../lib/logo-color";
import {
  contrastRatio,
  customerThemeVariables,
  normalizeCustomerPrimary,
} from "../lib/theme";

test("customer theme derives readable interaction colors from a logo color", () => {
  for (const color of ["#FFD400", "#E33A2E", "#168AAD", "#222222"]) {
    const variables = customerThemeVariables(color);
    assert.ok(variables);
    assert.ok(
      contrastRatio(
        variables["--primary"],
        variables["--primary-foreground"],
      ) >= 4.5,
    );
    assert.notEqual(variables["--primary"], variables["--primary-hover"]);
    assert.ok(
      contrastRatio(
        variables["--secondary"],
        variables["--secondary-foreground"],
      ) >= 4.5,
    );
  }
  assert.equal(normalizeCustomerPrimary("not-a-color"), null);
});

test("logo analysis ignores a white background and selects the colored mark", async () => {
  const logo = await sharp({
    create: {
      width: 160,
      height: 80,
      channels: 4,
      background: "#ffffff",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="60" height="60"><rect width="60" height="60" fill="#E33A2E"/></svg>',
        ),
        left: 10,
        top: 10,
      },
    ])
    .png()
    .toBuffer();
  const primary = await extractLogoPrimary(logo);
  assert.ok(primary);
  const variables = customerThemeVariables(primary);
  assert.ok(variables);
  assert.ok(
    contrastRatio(
      variables["--primary"],
      variables["--primary-foreground"],
    ) >= 4.5,
  );
});
