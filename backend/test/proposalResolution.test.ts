import assert from "node:assert/strict";
import test from "node:test";
import {
  bindCounterparties,
  COMPARED_TERM_FIELDS,
  resolveProposal,
} from "../src/domain/proposalResolution.js";
import { structuredTermsSchema, type StructuredTerms } from "../src/domain/terms.js";

const listing: StructuredTerms = {
  principalAtoms: "10000000000",
  loanMint: "USDC",
  rateBps: 1_000,
  durationMonths: 12,
  collateralLtvBps: 5_000,
};

test("an exact match confirms the existing on-chain deal", () => {
  const resolution = resolveProposal(listing, { ...listing });
  assert.equal(resolution.action, "confirm_existing");
  assert.deepEqual(resolution.differingFields, []);
});

test("any differing field supersedes the listing with a new private deal", () => {
  // Each field is checked individually so a comparison gap in any one of them
  // cannot hide behind another field that happens to differ.
  const variants: Array<[string, StructuredTerms]> = [
    ["principal", { ...listing, principalAtoms: "10000000001" }],
    ["loan mint", { ...listing, loanMint: "USDT" }],
    ["rate", { ...listing, rateBps: 1_001 }],
    ["duration", { ...listing, durationMonths: 24 }],
    ["ltv", { ...listing, collateralLtvBps: 4_999 }],
  ];
  for (const [label, proposed] of variants) {
    const resolution = resolveProposal(listing, proposed);
    assert.equal(
      resolution.action,
      "supersede_with_private_deal",
      `${label} should be treated as a counter-offer`,
    );
    assert.equal(resolution.differingFields.length, 1, `${label} should report one difference`);
  }
});

test("a one-basis-point difference is a counter-offer, not a match", () => {
  // There is deliberately no tolerance band on money terms.
  const resolution = resolveProposal(listing, { ...listing, rateBps: 1_001 });
  assert.equal(resolution.action, "supersede_with_private_deal");
  assert.deepEqual(resolution.differingFields, ["rateBps"]);
});

test("every schema field is actually compared", () => {
  // Guards against a new term being added to the schema but not to the
  // comparison list, which would let a mismatched value pass as exact.
  const schemaFields = Object.keys(structuredTermsSchema.shape).sort();
  assert.deepEqual([...COMPARED_TERM_FIELDS].sort(), schemaFields);
});

test("principal is compared numerically, beyond the safe integer range", () => {
  // u64 amounts exceed Number.MAX_SAFE_INTEGER, so string terms must compare as
  // integers rather than as text or as floats.
  const huge = "18446744073709551615";
  const hugeMinusOne = "18446744073709551614";
  assert.equal(
    resolveProposal(
      { ...listing, principalAtoms: huge },
      { ...listing, principalAtoms: huge },
    ).action,
    "confirm_existing",
  );
  assert.equal(
    resolveProposal(
      { ...listing, principalAtoms: huge },
      { ...listing, principalAtoms: hugeMinusOne },
    ).action,
    "supersede_with_private_deal",
  );
});

test("equal amounts written differently still match", () => {
  const resolution = resolveProposal(
    { ...listing, principalAtoms: "100" },
    { ...listing, principalAtoms: "0100" },
  );
  assert.equal(resolution.action, "confirm_existing");
});

test("multiple differences are all reported", () => {
  const resolution = resolveProposal(listing, {
    ...listing,
    rateBps: 900,
    durationMonths: 24,
    principalAtoms: "5000000000",
  });
  assert.equal(resolution.action, "supersede_with_private_deal");
  assert.deepEqual(resolution.differingFields.sort(), [
    "durationMonths",
    "principalAtoms",
    "rateBps",
  ]);
});

test("a borrow listing binds the poster as borrower", () => {
  const bound = bindCounterparties("borrow", "poster", "proposer");
  assert.deepEqual(bound, { borrower: "poster", lender: "proposer" });
});

test("a lend listing binds the poster as lender", () => {
  const bound = bindCounterparties("lend", "poster", "proposer");
  assert.deepEqual(bound, { borrower: "proposer", lender: "poster" });
});

test("a wallet cannot take both sides of its own deal", () => {
  assert.throws(() => bindCounterparties("borrow", "same", "same"), /cannot be both/i);
});
