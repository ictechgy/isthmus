# 브리지 수집 캐시 측정

2026-09-19 개발 중 측정. 같은 입력에서 새 isthmus 캐시로 수집하고 즉시 재사용했다.
네 케이스 모두 첫 수집은 miss, 두 번째는 hit였으며 전체 보고서가 동일했다.

| 케이스 | 새 수집 캐시(ms) | 재사용(ms) | 경계 | 근거 공백 |
|---|---:|---:|---:|---:|
| bridge-app | 2089 | 170 | 2 | 9 |
| sp-file-plugin | 1408 | 135 | 11 | 31 |
| sp-file-generated | 1320 | 138 | 11 | 31 |
| sp-symbol-legacy-remove | 1106 | 132 | 1 | 10 |

`bridge-app`은 합성 표본이다. 나머지 3개는 기존 공개 코퍼스의 shared_preferences_foundation
2.5.4 선택을 로컬 pub 캐시에서 스테이징했다. 캐시의 아카이브 해시 메타데이터는 manifest와
일치했으며 LICENSE와 스테이징한 트리 해시를 확인했다. 원격 아카이브를 다시 받아 캐시
내용을 재인증한 실행은 아니다. 전체 15케이스의 정밀도 재측정도 아니다.

cartograph는 설치본 0.18.0, dartograph는 로컬 0.14.0 AOT 빌드다. 합성 케이스에만 사용한
kartograph는 로컬 제품 소스를 Kotlin 2.4.0/JDK 21로 컴파일한 0.10.2 개발 빌드다.
SDK·Swift 빌드·JVM·생산자 캐시는 지우지 않았다. 각 케이스의 측정은 한 쌍뿐이며
앱 전체 빌드 시간이나 일반적인 속도 향상 추정으로 사용하지 않는다. Flutter 런타임 실행도 없다.

[원시 측정·버전·해시·스텝 시간](results/cache-measurements.json)에 관찰한 공백도 보존했다.

승인된 capture 설정에서 다음 명령으로 재현한다. 설정의 prepare/producer 명령이 실행된다.

```bash
node scripts/measure-preflight-cache.mjs capture.json measurement.json
```
