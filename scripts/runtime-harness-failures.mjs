/** SDK 출력의 인증·기기·경로 문자열을 복사하지 않고 실패 종류만 보존한다. */
export function describeBuildFailure(label, result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const category = result.error?.code === 'ETIMEDOUT' ? 'timeout'
    : /code.?sign|provisioning|development team|signing certificate/iu.test(output) ? 'code-signing'
      : /cocoapods|pod install|resolve dependencies|could not resolve/iu.test(output) ? 'dependency-resolution'
        : /compile|compilation|build failed|error:/iu.test(output) ? 'build'
          : 'command';
  return { label, exit: result.status, category };
}

/** cleanup 오류가 앞선 검증 오류를 덮지 않으며, 두 실패가 함께 있으면 모두 전달한다. */
export function throwHarnessFailures(primary, cleanupFailures) {
  const failures = [...(primary === undefined ? [] : [primary]), ...cleanupFailures];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Runtime verification and cleanup failed; inspect both causes.');
}
