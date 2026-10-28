// Behavior and merit are independent ledgers.
// Positive legacy records are merit; only explicit positive improvement records
// offset negative conduct records. Old free-form records remain readable.
export const meritWhen=(a='b')=>`(${a}.deleted_at IS NULL AND ${a}.points>0 AND (${a}.affairs_category IS NULL OR ${a}.affairs_category='good'))`;
export const violationWhen=(a='b')=>`(${a}.deleted_at IS NULL AND ${a}.points<0)`;
export const improvementWhen=(a='b')=>`(${a}.deleted_at IS NULL AND ${a}.points>0 AND ${a}.affairs_category='adjustment')`;
export const caseTypeSql=(a='b')=>`CASE WHEN ${meritWhen(a)} THEN 'good' WHEN ${improvementWhen(a)} THEN 'adjustment' ELSE 'behavior' END`;
export const scoreColumns=(a='b')=>`COALESCE(SUM(CASE WHEN ${meritWhen(a)} THEN ${a}.points ELSE 0 END),0) AS good_total,
 COALESCE(SUM(CASE WHEN ${violationWhen(a)} THEN -${a}.points ELSE 0 END),0) AS behavior_deducted,
 COALESCE(SUM(CASE WHEN ${improvementWhen(a)} THEN ${a}.points ELSE 0 END),0) AS behavior_adjusted`;
export const scoreSummary=row=>{
 const good_total=Math.max(0,Number(row?.good_total)||0);
 const behavior_deducted=Math.max(0,Number(row?.behavior_deducted)||0);
 const behavior_adjusted=Math.max(0,Number(row?.behavior_adjusted)||0);
 return {good_total,behavior_deducted,behavior_adjusted,
  behavior_remaining:Math.max(0,behavior_deducted-behavior_adjusted)};
};
export const scoreType=row=>row?.points>0?
 (row?.affairs_category==='adjustment'?'adjustment':'good'):'behavior';
