import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PhaseResult:
    phase: str
    step: int
    requests: int
    duration: float
    rps: float  # requests per second


class AIModelTester:
    def __init__(self, model, max_load: int = 100, steps: int = 10):
        self.model = model
        self.max_load = max_load
        self.steps = steps
        self.results: list[PhaseResult] = []

    def _run_phase(self, phase: str, step: int, requests: int, input_data: Any) -> float:
        start = time.perf_counter()
        for _ in range(requests):
            self.model.predict(input_data)
        duration = time.perf_counter() - start
        rps = requests / duration if duration > 0 else 0.0
        self.results.append(PhaseResult(phase, step, requests, duration, rps))
        return rps

    def run_test(self, input_data: Any = None) -> None:
        self.results.clear()
        start_time = time.perf_counter()
        step_size = self.max_load // self.steps

        print("=== AI 모델 테스트 시작 ===\n")

        # 단계 1: 모델 활성화 후 점진적 부하 증가 (ramp-up)
        print("[단계 1] 점진적 활성화 (Ramp-Up)")
        self.model.activate()
        for step in range(1, self.steps + 1):
            requests = step_size * step
            rps = self._run_phase("ramp_up", step, requests, input_data)
            print(f"  Step {step:2d}/{self.steps}: {requests:4d} 요청 → RPS = {rps:8.2f}")

        # 단계 2: 최대 부하 유지
        print("\n[단계 2] 최대 부하 유지 (Maintain)")
        rps = self._run_phase("maintain", 0, self.max_load, input_data)
        print(f"  최대 부하 유지: {self.max_load} 요청 → RPS = {rps:8.2f}")

        # 단계 3: 점진적 부하 감소 후 모델 비활성화 (ramp-down)
        print("\n[단계 3] 점진적 비활성화 (Ramp-Down)")
        for step in range(self.steps, 0, -1):
            requests = step_size * step
            rps = self._run_phase("ramp_down", step, requests, input_data)
            print(f"  Step {step:2d}/{self.steps}: {requests:4d} 요청 → RPS = {rps:8.2f}")
        self.model.deactivate()

        total_time = time.perf_counter() - start_time
        self._print_report(total_time)

    def _print_report(self, total_time: float) -> None:
        if not self.results:
            print("결과 없음")
            return

        all_rps = [r.rps for r in self.results]
        total_requests = sum(r.requests for r in self.results)

        print(f"\n{'=' * 35}")
        print(f"  테스트 결과")
        print(f"{'=' * 35}")
        print(f"  총 소요 시간  : {total_time:.2f}초")
        print(f"  총 처리 요청수: {total_requests}건")
        print(f"  평균 RPS      : {sum(all_rps) / len(all_rps):.2f}")
        print(f"  최대 RPS      : {max(all_rps):.2f}")
        print(f"  최소 RPS      : {min(all_rps):.2f}")
        print(f"{'=' * 35}")

    def calculate_average_rps(self) -> float:
        if not self.results:
            return 0.0
        return sum(r.rps for r in self.results) / len(self.results)


class MockModel:
    """시뮬레이션용 모델. 실제 모델로 교체 시 같은 인터페이스 구현."""

    def __init__(self, latency: float = 0.001):
        self.latency = latency
        self._active = False

    def activate(self) -> None:
        self._active = True
        print("  [모델] 활성화됨\n")

    def deactivate(self) -> None:
        self._active = False
        print("\n  [모델] 비활성화됨")

    def predict(self, input_data: Any) -> str:
        if not self._active:
            raise RuntimeError("모델이 활성화되지 않은 상태에서 predict() 호출됨")
        time.sleep(self.latency)
        return "응답"


if __name__ == "__main__":
    model = MockModel(latency=0.001)
    tester = AIModelTester(model, max_load=100, steps=10)
    tester.run_test(input_data="샘플 입력 데이터")
