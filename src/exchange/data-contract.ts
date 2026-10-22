/** 생산자가 직접 관찰한 유한 필드 목록이다. 누락된 속성은 unknown이며 전체 계약의 완전성을 뜻하지 않는다. */
export interface DataContractField {
  readonly in: 'request-body' | 'response-body' | 'query' | 'header' | 'column' | 'constraint';
  readonly path: string;
  readonly type?: string;
  readonly nullable?: boolean;
  readonly required?: boolean;
}

/** HTTP와 DB 생산자가 보존하는 선택적 계약 근거다. 런타임 값·실패 예측을 담지 않는다. */
export interface DataContract {
  readonly version: 1;
  readonly fields: readonly DataContractField[];
  readonly limitations: readonly string[];
}

/** 큰 생산자 입력이 비교·출력 예산을 우회하지 못하게 한다. */
export const MAX_CONTRACT_FIELDS = 512;
const locations = new Set(['request-body', 'response-body', 'query', 'header', 'column', 'constraint']);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === 'string' &&
  value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);

/** 스키마와 유일 키를 검증한다. 모르는 확장을 버려 거짓 동일 판정을 만들지 않는다. */
export function dataContractProblem(value: unknown, persistence: boolean): string | undefined {
  if (!object(value) || value.version !== 1 || Object.keys(value).some((key) => !['version', 'fields', 'limitations'].includes(key)) ||
    !Array.isArray(value.fields) || value.fields.length > MAX_CONTRACT_FIELDS ||
    !Array.isArray(value.limitations) || value.limitations.length > 128 || !value.limitations.every((item) => text(item, 2048))) {
    return 'Invalid data contract or contract budget exceeded.';
  }
  const seen = new Set<string>();
  for (const field of value.fields) {
    if (!object(field) || !locations.has(field.in as string) || !text(field.path, 1024) ||
      Object.keys(field).some((key) => !['in', 'path', 'type', 'nullable', 'required'].includes(key)) ||
      (field.type !== undefined && !text(field.type, 1024)) ||
      (field.nullable !== undefined && typeof field.nullable !== 'boolean') ||
      (field.required !== undefined && typeof field.required !== 'boolean') ||
      persistence !== (field.in === 'column' || field.in === 'constraint')) return 'Invalid data contract field.';
    const key = JSON.stringify([field.in, field.path]);
    if (seen.has(key)) return 'Duplicate data contract field.';
    seen.add(key);
  }
  return undefined;
}

/** 검증된 근거만 결정적 순서로 복사한다. */
export function normalizeDataContract(value: DataContract): DataContract {
  return { version: 1, fields: value.fields.map((field) => ({ in: field.in, path: field.path,
    ...(field.type === undefined ? {} : { type: field.type }),
    ...(field.nullable === undefined ? {} : { nullable: field.nullable }),
    ...(field.required === undefined ? {} : { required: field.required }) }))
    .sort((a, b) => JSON.stringify([a.in, a.path]) < JSON.stringify([b.in, b.path]) ? -1 : 1),
  limitations: [...new Set(value.limitations)].sort() };
}
