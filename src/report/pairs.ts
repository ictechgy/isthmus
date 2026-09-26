import { compareStrings } from '../compare.ts';
import type { BridgeLocation, BridgePlatform, BridgeSymbol } from '../exchange/parse.ts';
import type { BridgeEndpoint, BridgeJoinResult } from '../join/join.ts';
import { compareEndpoints, isBridgeJoinDeferred, relationDeclKey } from '../join/join.ts';
import { encodeSortedJson } from './sorted-json.ts';

/**
 * `check --pairs`가 싣는 끝점이다. 사실의 플랫폼·위치·심볼만 원형 그대로 복사한다.
 *
 * 심볼은 가공하지 않는다 — 사용 측 `symbol.usr`는 생산자의 impact id이고, 선언 측
 * `symbol.qualifiedName`은 schemagraph 그래프 정점 id라 그대로 다음 도구에 넘긴다.
 */
export interface PairEndpoint {
  readonly platform: BridgePlatform;
  readonly location?: BridgeLocation;
  readonly symbol?: BridgeSymbol;
}

/**
 * persistence 매치 하나의 논리 키다.
 *
 * `relation`은 조인이 해석한 선언 측 한정 이름(선언 철자 중 최솟값)이다. `column`은
 * 사용 측 컬럼 철자 중 최솟값이다 — 대소문자만 다른 철자는 조인과 같이 한 키로 합친다.
 */
export interface PersistenceMatchKey {
  readonly relation: string;
  readonly column?: string;
}

/** 사용과 선언이 모두 관찰된 persistence 관계 또는 (관계, 컬럼) 하나다. */
export interface PersistenceMatch {
  readonly domain: 'persistence';
  readonly key: PersistenceMatchKey;
  readonly uses: readonly PairEndpoint[];
  readonly decls: readonly PairEndpoint[];
}

/**
 * 매치 전체가 실을 수 있는 사용·선언 끝점 총상한이다.
 *
 * 선언 끝점은 매치마다 다시 실리므로 출력이 입력보다 커질 수 있다. graph의 간선 상한과
 * 같은 자원 거버넌스이며, 넘으면 부분 목록 대신 실패한다.
 */
export const MAX_PAIR_ENDPOINTS = 100_000;

/** 매치 끝점이 상한을 넘어 쌍 목록을 만들 수 없음을 나타낸다. */
export class PersistencePairsLimitError extends Error {
  /** 입력 내용을 담지 않는 고정 문구만 보존한다. */
  constructor() {
    super(
      `Cannot produce persistence pairs with more than ${MAX_PAIR_ENDPOINTS} use and declaration `
      + 'endpoints; narrow the check inputs (fewer documents or a smaller scan scope) and retry. '
      + 'No partial pair list is emitted.',
    );
    this.name = 'PersistencePairsLimitError';
  }
}

/**
 * 조인 결과의 persistence 매치를 사용↔선언 쌍 목록으로 바꾼다.
 *
 * 조인은 사용 버킷(원문 이름)마다 매치를 따로 내므로, 같은 선언으로 해석된 비한정·한정
 * 사용('users'와 'public.users')이 두 항목이 된다. 쌍 목록은 선언 관계(와 접은 컬럼)로
 * 다시 합치고 끝점을 중복 제거·정렬해 입력 순서와 무관하게 만든다. 매치되지 않은 사용·
 * 선언은 싣지 않는다 — 그것들은 check 진단에 이미 있다.
 */
export function createPersistenceMatches(joined: BridgeJoinResult): PersistenceMatch[] {
  if (isBridgeJoinDeferred(joined)) {
    throw new Error('Cannot create persistence pairs from a deferred bridge join.');
  }
  const groups = new Map<string, MutableMatch>();
  for (const { channel, uses, decls } of joined.matchedRelations) {
    mergeMatch(groups, relationDeclKey(channel), { relation: channel }, uses, decls);
  }
  for (const { channel, column, uses, decls } of joined.matchedColumns) {
    mergeMatch(groups, relationDeclKey(channel, column), { relation: channel, column }, uses, decls);
  }
  const matches = [...groups.values()].map(toMatch).sort(compareMatchKeys);
  const endpoints = matches.reduce((total, match) => total + match.uses.length + match.decls.length, 0);
  if (endpoints > MAX_PAIR_ENDPOINTS) throw new PersistencePairsLimitError();
  return matches;
}

/** 합치는 중인 매치다. 끝점은 결정적 직렬화 키로 중복을 제거한다. */
interface MutableMatch {
  key: PersistenceMatchKey;
  readonly uses: Map<string, PairEndpoint>;
  readonly decls: Map<string, PairEndpoint>;
}

/** 같은 논리 키의 조인 항목을 한 매치로 합친다. 키 철자는 최솟값으로 고정한다. */
function mergeMatch(
  groups: Map<string, MutableMatch>,
  identity: string,
  key: PersistenceMatchKey,
  uses: readonly BridgeEndpoint[],
  decls: readonly BridgeEndpoint[],
): void {
  const group = groups.get(identity) ?? { key, uses: new Map(), decls: new Map() };
  if (compareStrings(key.column ?? '', group.key.column ?? '') < 0) group.key = key;
  for (const endpoint of uses) addEndpoint(group.uses, endpoint);
  for (const endpoint of decls) addEndpoint(group.decls, endpoint);
  groups.set(identity, group);
}

/** 끝점을 쌍 계약의 세 필드로 줄여 중복 없이 담는다. */
function addEndpoint(target: Map<string, PairEndpoint>, endpoint: BridgeEndpoint): void {
  const projected: PairEndpoint = {
    platform: endpoint.platform,
    ...(endpoint.location === undefined ? {} : { location: endpoint.location }),
    ...(endpoint.symbol === undefined ? {} : { symbol: endpoint.symbol }),
  };
  target.set(encodeSortedJson(projected, true), projected);
}

/** 합친 매치를 조인과 같은 끝점 순서로 고정한다. */
function toMatch(group: MutableMatch): PersistenceMatch {
  return {
    domain: 'persistence',
    key: group.key,
    uses: [...group.uses.values()].sort(compareEndpoints),
    decls: [...group.decls.values()].sort(compareEndpoints),
  };
}

/** 관계, 그다음 컬럼 순으로 정렬한다. 관계 수준 매치(컬럼 없음)가 먼저 온다. */
function compareMatchKeys(left: PersistenceMatch, right: PersistenceMatch): number {
  if (left.key.relation !== right.key.relation) {
    return compareStrings(left.key.relation, right.key.relation);
  }
  if (left.key.column === undefined) return right.key.column === undefined ? 0 : -1;
  if (right.key.column === undefined) return 1;
  return compareStrings(left.key.column, right.key.column);
}
