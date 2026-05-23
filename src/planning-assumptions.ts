export const SERVICE_DEMAND_ASSUMPTIONS = {
    sqmPerResident: 33,
    kindergartenSeatsPerResident: 0.036,
    elderlyServiceCapacityPerResident: 0.03,
    parcelPublicServiceGfaRatio: 0.015,
};

export function serviceDemandAssumptionText(): string {
    return [
        `居住人口按每人 ${SERVICE_DEMAND_ASSUMPTIONS.sqmPerResident} 平方米住宅建面估算`,
        `幼儿园学位按人口 ${(SERVICE_DEMAND_ASSUMPTIONS.kindergartenSeatsPerResident * 100).toFixed(1)}% 估算`,
        `社区养老服务能力按人口 ${(SERVICE_DEMAND_ASSUMPTIONS.elderlyServiceCapacityPerResident * 100).toFixed(1)}% 估算`,
    ].join('；');
}
