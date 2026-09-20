import type { BridgeMessageDocument } from '../exchange/messages.ts';
import { scanJsEvents } from './js-scan.ts';
import type { JsSourceFile } from './js-document.ts';

/** 파일별 RN 이벤트 구독을 독립된 v2 전송 문서로 조립한다. */
export function createJsEventFactsDocument(
  files: readonly JsSourceFile[], toolVersion: string, generatedAt: string, project: string,
): BridgeMessageDocument {
  const scans = files.map((file) => ({ file, scan: scanJsEvents(file.text) }));
  const facts = scans.flatMap(({ file, scan }) => scan.facts.map((fact) => ({
    kind: 'event-listen' as const, channel: fact.channel, dynamic: fact.dynamic,
    location: { path: file.path, line: fact.token.line, column: fact.token.column },
  })));
  const unsupported = scans.reduce((count, { scan }) => count + scan.unsupported, 0);
  const dynamic = facts.filter((fact) => fact.dynamic).length;
  return {
    format: 'bridge-facts', version: 2, transport: 'react-native-event', platform: 'js',
    target: facts.length ? 'react-native' : null, project, generatedAt,
    tool: { name: 'isthmus', version: toolVersion }, facts,
    limitations: [
      'rn-event-scan-scope: only stable core RN ESM/CommonJS namespace emitters and direct NativeEventEmitter instances are scanned; let/var instances require module scope; Expo, codegen, wrappers and cross-file emitter bindings are not resolved',
      ...(unsupported ? [`unresolved-js-event-emitters: ${unsupported} emitter bindings or subscriptions could not be resolved`] : []),
      ...(dynamic ? [`dynamic-event-names: ${dynamic} event subscriptions have a non-literal name`] : []),
    ],
  };
}
