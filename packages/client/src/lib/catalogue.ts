import type { GameId } from "@board-online/shared";
export type Category = "전체" | "전략" | "전통" | "가볍게";
interface GameDetail {
  art: number;
  description: string;
  categories: Category[];
  instruction: string;
  hint: string;
}
export const GAME_DETAILS: Record<GameId, GameDetail> = {
  gomoku: {
    art: 0,
    description: "가장 단순한 규칙, 가장 깊은 수읽기.",
    categories: ["전략", "가볍게"],
    instruction: "교차점을 눌러 돌을 놓으세요.",
    hint: "가로, 세로, 대각선으로 다섯 돌을 이어보세요.",
  },
  chess: {
    art: 1,
    description: "세계를 넘어 사랑받는 전략의 정석.",
    categories: ["전략"],
    instruction: "말을 선택하고 이동할 칸을 누르세요.",
    hint: "상대의 킹이 피할 수 없는 체크메이트를 만들어보세요.",
  },
  janggi: {
    art: 2,
    description: "한국의 전통, 한 수에 담긴 깊은 생각.",
    categories: ["전략", "전통"],
    instruction: "말을 선택하고 이동할 곳을 누르세요.",
    hint: "각 말의 길을 읽고 상대 궁을 외통장군으로 몰아보세요.",
  },
  checkers: {
    art: 3,
    description: "한 칸의 전진, 연속 점프의 반전.",
    categories: ["전략", "가볍게"],
    instruction: "말을 선택하고 이동할 칸을 누르세요.",
    hint: "잡을 수 있는 말은 반드시 잡아요. 끝에 닿으면 킹이 됩니다.",
  },
  reversi: {
    art: 4,
    description: "흑과 백 사이, 끝까지 모르는 승부.",
    categories: ["전략"],
    instruction: "표시된 칸을 눌러 상대 돌을 뒤집으세요.",
    hint: "상대 돌을 양쪽에서 둘러싸고, 마지막에 더 많은 돌을 남겨보세요.",
  },
  gonu: {
    art: 5,
    description: "네 개의 돌로 즐기는 작은 수싸움.",
    categories: ["전통", "가볍게"],
    instruction: "내 돌을 선택해 연결된 빈 곳으로 옮기세요.",
    hint: "첫 수는 오른쪽 아래 흑돌부터. 우물은 건널 수 없어요.",
  },
  yut: {
    art: 6,
    description: "도개걸윷모, 함께 돌아오는 즐거움.",
    categories: ["전통", "가볍게"],
    instruction: "윷을 던진 뒤 이동할 말을 선택하세요.",
    hint: "윷·모가 나오거나 상대 말을 잡으면 한 번 더 던질 수 있어요.",
  },
  territory: {
    art: 7,
    description: "한 줄씩 이어 넓혀가는 나만의 땅.",
    categories: ["가볍게"],
    instruction: "내 땅에서 선을 그려 다시 돌아오세요.",
    hint: "선을 이어 영역을 둘러싸면 안쪽까지 내 땅이 됩니다.",
  },
  flick: {
    art: 8,
    description: "손끝의 감각으로 조금 더 넓게.",
    categories: ["가볍게", "전통"],
    instruction: "돌을 끌어 방향과 힘을 정하고 놓으세요.",
    hint: "세 번 튕겨 내 땅으로 돌아오면 지나온 영역을 차지해요.",
  },
};
