# ADR-0003: 실시간 서버는 Node + Socket.IO, 서버 권위 모델

- 상태: 채택 (2026-09)
- 맥락: 턴제 2인 대국. 필요한 것은 룸, 재접속, 순서 보장, 서버 시계. 상태 델타 동기화나 틱 기반 시뮬레이션은 불필요.
- 결정: Fastify 위 Socket.IO. 룸당 `GameSession`이 규칙 모듈로 수를 검증하고 방송. 상태 저장은 "옵션+시드+수 목록". MVP는 단일 인스턴스, 확장은 Redis adapter + 룸 소유 인스턴스 고정.
- 대안: Colyseus (룸·상태 동기화 내장이나 Schema 직렬화가 턴제에 과함, 프레임워크 종속), 순수 `ws`(재접속·ack 직접 구현), Cloudflare Durable Objects(룸 모델에 이상적이나 Workers 런타임 제약·종속. Phase 3 재검토).
- 결과: 서버리스에서 호스팅 불가 → 웹(Vercel)과 실시간(Fly.io) 두 배포 단위. 수 페이로드는 작고 검증은 서버 CPU 수 ms.
