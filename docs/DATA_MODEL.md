# 데이터 모델

## 저장 위치

- 앱 데이터 저장소: Supabase DB
  - `budget_settings`: 월 시작일, 기본 예산, 월별 예산, 항목별 예산
  - `transactions`: 거래 내역
- 브라우저 `localStorage`에는 예산/거래 데이터를 저장하지 않는다.
- Supabase Auth 세션 유지를 위한 브라우저 저장소 사용은 허용된다.

## 상태 구조

```json
{
  "version": 1,
  "monthlyBudget": 500000,
  "categoryBudgets": {
    "생활비": 200000,
    "배달비": 100000
  },
  "monthStartDay": 25,
  "monthlyBudgets": {
    "2026-05": {
      "monthlyBudget": 700000,
      "categoryBudgets": {
        "생활비": 300000,
        "배달비": 100000
      }
    }
  },
  "transactions": [
    {
      "id": "tx-...",
      "date": "2026-05-25",
      "type": "expense",
      "category": "생활비",
      "amount": 12000,
      "memo": "점심",
      "source": "user"
    }
  ]
}
```

## 필드 설명

- `version`: 데이터 구조 버전. 현재는 `1`.
- `monthlyBudget`: 월별 예산이 없는 기간에 쓰는 기본 월 지출 예산. 1 이상의 정수.
- `categoryBudgets`: 월별 항목 예산이 없는 기간에 쓰는 기본 항목 예산.
- `monthStartDay`: 예산 기간 시작일. 1~31 사이 정수.
- `monthlyBudgets`: `YYYY-MM` 키별 예산 설정.
  - 예: `monthStartDay`가 25이고 키가 `2026-05`이면 `2026-05-25 ~ 2026-06-24` 기간 예산이다.
  - `monthlyBudget`: 해당 기간 총 지출 예산.
  - `categoryBudgets`: 해당 기간 항목별 예산.
- `transactions`: 거래 배열.
- `id`: 거래 고유 ID. `tx-` 접두사를 사용한다.
- `date`: 실제 존재하는 `YYYY-MM-DD` 형식 날짜.
- `type`: `income` 또는 `expense`.
- `category`: 선택한 유형에 맞는 카테고리.
- `amount`: 금액. 1 이상의 정수.
- `memo`: 선택 입력 메모. 최대 80자.
- `source`: `user` 또는 `sample`. 샘플 데이터 중복 방지와 교체에 사용한다.

## Supabase 매핑

- `budget_settings.monthly_budget`: 기본 월 예산.
- `budget_settings.category_budgets`: 기본 항목 예산과 함께 아래 내부 설정을 JSON으로 보관한다.
  - `__month_start_day`: 월 시작일.
  - `__monthly_budgets`: 월별 예산 설정.
- `transactions`: 거래 내역 전체.

## 카테고리

- 지출: 생활비, 배달비, 의류비, 비상금
- 수입: 월급, 용돈, 부수입, 기타

## 오류 복구

저장소가 비어 있거나 데이터 형식이 잘못되면 기본 상태로 복구한다. 일부 거래 필드가 잘못된 경우 해당 거래만 제외하고 가능한 정상 데이터는 유지한다.

```json
{
  "version": 1,
  "monthlyBudget": 500000,
  "categoryBudgets": {},
  "monthStartDay": 1,
  "monthlyBudgets": {},
  "transactions": []
}
```

## 내보내기/가져오기

- 내보내기는 현재 정규화된 상태를 JSON 파일로 다운로드한다.
- 가져오기는 JSON 파싱 후 같은 정규화 규칙을 적용한다.
- 가져올 거래가 0건이면 현재 데이터를 빈 데이터로 교체하지 않고 중단한다.
- 잘못된 거래는 제외하고, 제외된 건수는 가져오기 확인 메시지에 표시한다.
- 중복된 거래 ID는 가져오기/정규화 과정에서 새 ID로 재발급한다.
- 가져오기 파일은 1MB 이하만 허용한다.
- 가져오기는 현재 데이터를 교체하므로 사용자 확인을 거친다.
