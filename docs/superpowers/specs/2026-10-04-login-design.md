# 로그인(전화번호 + 비밀번호) 설계

> 2026-10-04 · 승인된 대화 설계를 문서로 옮김

## 목적
- 내가 만든 모임과 응답한 모임이 **어느 기기에서든** "내 알림장"에 보이게 한다.
- 기기 이동 시 주최자·참석자 권한이 끊기지 않게 한다.
- 참석 응답은 지금처럼 **로그인 없이도** 링크만으로 가능해야 한다(시연 청중 300~400명).

## 결정 사항
| 항목 | 결정 |
|---|---|
| 로그인 방식 | 전화번호 + 비밀번호 (문자 인증 없음, 확장 과제로 명시) |
| 로그인 필수 범위 | 안내장 만들기·내 알림장은 필수, 참석 응답은 선택 |
| 비밀번호 | 4~30자, scrypt + 사용자별 salt로 해시 저장 |
| 세션 | 무작위 토큰, Redis `session:{token}` 30일 TTL, 브라우저 `localStorage` 저장 |
| 로그인 실패 제한 | 같은 번호 10회 실패 시 15분 차단 (`loginfail:{phone}`) |
| 전화번호 | 숫자만 남겨 `01012345678` 형태로 정규화, 공개 응답에는 절대 포함하지 않음 |

## 데이터 (Upstash)
| 키 | 값 |
|---|---|
| `user:{phone}` | `{ phone, name, passHash, salt, createdAt }` |
| `session:{token}` | `phone` (EX 30일) |
| `user:{phone}:events` (hash) | `eventId → { role: 'host' \| 'guest', pid?, at }` |
| `event:{id}` | 기존 + `ownerPhone` (공개 응답에서 제거) |
| `event:{id}:p` 참가자 | 기존 + `userPhone` (공개 응답에서 제거) |

## API (`api/events.js`, 모두 POST, `session` 필드로 로그인 전달)
| action | 동작 |
|---|---|
| `signup {phone, name, password}` | 가입 → `{ session, user }`. 이미 있는 번호면 409 |
| `login {phone, password}` | 로그인 → `{ session, user }`. 실패 횟수 제한 |
| `logout {session}` | 세션 삭제 |
| `whoami {session}` | `{ user }` 또는 401 |
| `mine {session}` | 내 모임 목록 `[{ role, event, participants, stamp }]` |
| `me {session, id}` | 이 안내장에서 내 권한 `{ isHost, participant }` (CDN 캐시 대상 아님) |
| `claim {session, hosted:[{id,token}], joined:[{id,pid,ptoken}]}` | 브라우저에 있던 기록을 계정으로 옮김 (토큰 검증 후) |
| `create` | **로그인 필수**. `ownerPhone` 기록, 내 모임에 host 추가. `editToken`은 계속 발급(관리 링크용) |
| `edit/settle/each/host` | 주최자 확인: `session` 사용자 == `ownerPhone` **또는** `editToken` |
| `rsvp` | `session`이 있으면 `userPhone` 기록, 내 모임에 guest 추가. 같은 계정이 이미 응답했으면 새로 만들지 않고 기존 응답 수정 |
| `self` | 본인 확인: `ptoken` **또는** `session` 사용자 == `userPhone` |

## 화면
- 상단바: 비로그인 "로그인" / 로그인 "{이름} 님 · 로그아웃"
- `#/login?next=` 새 화면: 로그인·회원가입 탭, 완료 후 `next`로 이동, 이 브라우저 기록을 `claim`
- 안내장 만들기: 비로그인 시 `#/login?next=/create`로 이동
- 내 알림장: 비로그인 시 로그인 안내. 로그인 시 `mine` 결과로 만든 모임 + 응답한 모임(카드에 **주최/참여** 표시, 참여 카드는 "자세히 보기"만)
- 초대장: 로그인 상태면 `me`로 주최자/참가자 판단, 이름 자동 입력, 응답이 계정에 연결. 비로그인 시 "로그인하면 내 알림장에 저장돼요" 안내
- 체험 모드(로컬)도 같은 규칙을 브라우저 저장소로 흉내 냄

## 심사용 테스트 계정
- 샘플 모임 6개가 들어 있는 계정 1개를 배포 서버에 만들고, 번호·비밀번호를 기획안 p.13/p.17에 기재

## 검증
- 자동 테스트: 가입·중복 가입, 로그인·오답·실패 제한, 세션 만료/로그아웃, 비로그인 생성 거절, 주최자 세션 권한, 다른 사용자 거절, 로그인 응답 중복 방지, `mine` 목록, `claim` 토큰 검증, 공개 응답에 전화번호 없음
- 배포 후 PC·휴대폰 두 기기로 만들기 → 다른 기기 로그인 → 내 알림장·수정·응답 확인

## 범위 밖
- 문자 인증, 비밀번호 찾기(재설정), 회원 탈퇴 — 기획안에 확장 과제로 기재
