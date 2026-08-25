/**
 * Anchor instruction discriminators — sha256("global:<snake_case_name>")[0..8].
 *
 * Precomputed constants (not computed at runtime) because these values are
 * immutable — the instruction names are fixed in the deployed programs — and
 * because the browser offers no synchronous sha256. The protocol test suite
 * recomputes every entry from first principles and compares.
 */
export const DISCRIMINATORS = {
  proposeDeal: "ca36e6319150ca44",
  confirmDeal: "73383ee8c1f39c58",
  cancelDeal: "9e56c12da86f301d",
  beginFunding: "f08e111c3bd139fb",
  markActive: "8cb2109f56bd63a4",
  closeDeal: "9dad21d892104152",
  initializeVault: "30bfa32c47813fa4",
  depositCollateral: "9c838e7492f7a278",
  lockVault: "58db7a731cecde75",
  releaseCollateral: "28ff0cdaf9c5b3a0",
  seizeCollateral: "28fa07f3a8b8749a",
  activateLoan: "5e2caac410aa4a65",
  makePayment: "13809979ddc05b35",
  repayInFull: "8eac64a49e0d3bff",
  flagDefault: "798e984770e07980",
  markLiquidated: "d5a4f27f201e8e61",
  addAssetType: "0ff732a11356a2a7",
  recordOriginationFee: "4a5d70545f528bf0",
  evaluate: "b3d38eb76c6814d6",
  executePartialLiquidation: "55df87f5070e3351",
  executeFullLiquidation: "4ef3e052ac9372cd",
  initializeGovernance: "ab5765ed1b6bc939",
  emergencyPause: "158f1b8ec8b5d2ff",
  emergencyUnpause: "53f9c339cebd1f55",
  initializeOracle: "90df8378c4fdb563",
  initializeRegistry: "bdb51411ae39f93b",
  initializeLoanConfig: "a4a0aa4bc684fe42",
  initializeEngine: "119e99d777f29c6b",
  initializeTreasury: "7cbad3c355a581a6",
} as const;
export type InstructionName = keyof typeof DISCRIMINATORS;
