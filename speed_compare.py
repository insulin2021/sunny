import time
import requests
from ai_model_tester import AIModelTester, PhaseResult


class OllamaModel:
    """Ollama 로컬 서버 (기본 포트 11434)"""

    def __init__(self, model_name: str = "gemma4:e4b", host: str = "http://localhost:11434"):
        self.model_name = model_name
        self.host = host
        self._active = False

    def activate(self) -> None:
        # 서버 연결 확인
        try:
            r = requests.get(f"{self.host}/api/tags", timeout=5)
            r.raise_for_status()
            self._active = True
            print(f"  [Ollama] 연결됨 ({self.host})\n")
        except Exception as e:
            raise RuntimeError(f"Ollama 서버 연결 실패: {e}")

    def deactivate(self) -> None:
        self._active = False
        print("\n  [Ollama] 비활성화됨")

    def predict(self, input_data: str) -> str:
        if not self._active:
            raise RuntimeError("모델이 활성화되지 않았습니다.")
        r = requests.post(
            f"{self.host}/api/generate",
            json={"model": self.model_name, "prompt": input_data, "stream": False},
            timeout=60,
        )
        r.raise_for_status()
        return r.json().get("response", "")


class LMStudioModel:
    """LM Studio 로컬 서버 (OpenAI 호환 API, 기본 포트 1234)"""

    def __init__(self, model_name: str = "gemma:e4b", host: str = "http://localhost:1234"):
        self.model_name = model_name
        self.host = host
        self._active = False

    def activate(self) -> None:
        try:
            r = requests.get(f"{self.host}/v1/models", timeout=5)
            r.raise_for_status()
            self._active = True
            print(f"  [LM Studio] 연결됨 ({self.host})\n")
        except Exception as e:
            raise RuntimeError(f"LM Studio 서버 연결 실패: {e}")

    def deactivate(self) -> None:
        self._active = False
        print("\n  [LM Studio] 비활성화됨")

    def predict(self, input_data: str) -> str:
        if not self._active:
            raise RuntimeError("모델이 활성화되지 않았습니다.")
        r = requests.post(
            f"{self.host}/v1/chat/completions",
            json={
                "model": self.model_name,
                "messages": [{"role": "user", "content": input_data}],
                "max_tokens": 50,
                "stream": False,
            },
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


def print_comparison(name_a: str, results_a: list[PhaseResult],
                     name_b: str, results_b: list[PhaseResult]) -> None:
    def stats(results):
        rps_list = [r.rps for r in results]
        return {
            "avg": sum(rps_list) / len(rps_list),
            "max": max(rps_list),
            "min": min(rps_list),
            "total": sum(r.requests for r in results),
        }

    a, b = stats(results_a), stats(results_b)
    winner = name_a if a["avg"] > b["avg"] else name_b
    diff = abs(a["avg"] - b["avg"]) / min(a["avg"], b["avg"]) * 100

    print(f"\n{'=' * 50}")
    print(f"  비교 결과")
    print(f"{'=' * 50}")
    print(f"  {'항목':<12} {name_a:>15} {name_b:>15}")
    print(f"  {'-' * 44}")
    print(f"  {'평균 RPS':<12} {a['avg']:>15.2f} {b['avg']:>15.2f}")
    print(f"  {'최대 RPS':<12} {a['max']:>15.2f} {b['max']:>15.2f}")
    print(f"  {'최소 RPS':<12} {a['min']:>15.2f} {b['min']:>15.2f}")
    print(f"  {'총 요청수':<12} {a['total']:>15} {b['total']:>15}")
    print(f"  {'-' * 44}")
    print(f"  승자: {winner} (평균 RPS {diff:.1f}% 빠름)")
    print(f"{'=' * 50}\n")


if __name__ == "__main__":
    PROMPT = "What is 2+2? Answer in one word."
    MAX_LOAD = 10   # 요청 수 (모델 속도에 따라 조정)
    STEPS = 5       # 단계 수

    print("\n" + "=" * 50)
    print("  Ollama vs LM Studio 속도 비교 테스트")
    print("=" * 50)

    # --- Ollama 테스트 ---
    print("\n[Ollama] gemma4:e4b 테스트 시작")
    ollama = OllamaModel(model_name="gemma4:e4b")
    tester_a = AIModelTester(ollama, max_load=MAX_LOAD, steps=STEPS)
    try:
        tester_a.run_test(input_data=PROMPT)
    except RuntimeError as e:
        print(f"  오류: {e}")

    # --- LM Studio 테스트 ---
    print("\n[LM Studio] gemma:e4b 테스트 시작")
    lmstudio = LMStudioModel(model_name="gemma:e4b")
    tester_b = AIModelTester(lmstudio, max_load=MAX_LOAD, steps=STEPS)
    try:
        tester_b.run_test(input_data=PROMPT)
    except RuntimeError as e:
        print(f"  오류: {e}")

    # --- 비교 ---
    if tester_a.results and tester_b.results:
        print_comparison(
            "Ollama/gemma4:e4b", tester_a.results,
            "LMStudio/gemma:e4b", tester_b.results,
        )
