import { createComponent, Types } from '@iwsdk/core';

export const TargetRole = {
  Seed: 'seed',
  Pot: 'pot',
  Duration: 'duration',
  Species: 'species',
} as const;

/** Marks an object the user can click or ray-select as a fallback to hand gestures. */
export const TendTarget = createComponent('TendTarget', {
  role: { type: Types.Enum, enum: TargetRole, default: TargetRole.Pot },
});
