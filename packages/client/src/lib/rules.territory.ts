import { TERRITORY_MAX_LINE } from "@board-online/shared";

/**
 * Rules text for 땅따먹기 (territory capture, line-drawing variant).
 *
 * Kept as a standalone module — rather than merged into rules.ts — because
 * territory's game id isn't wired into the shared RULES map yet.
 */
export const territoryRules = {
  title: "땅따먹기 (선 그리기)",
  points: [
    "14×14 칸 보드이며, 왼쪽 위 모서리는 파랑, 오른쪽 아래 모서리는 빨강의 3×3 시작 진영입니다. 나머지는 모두 빈 땅입니다.",
    "선은 칸 안이 아니라 칸과 칸 사이의 격자선(모서리) 위에 긋습니다. 내 땅의 모서리를 짚고 손가락(또는 마우스)을 끌면 그 자리부터 선이 따라옵니다.",
    "내 땅에서 출발해 밖으로 나갔다가 다시 내 땅 모서리에 닿게 이으면, 그 선과 기존 땅이 함께 둘러싼 빈 칸이 모두 내 땅이 됩니다. 상대 땅이 그 울타리의 일부를 이루더라도 바깥과 통하지 않으면 그대로 차지합니다.",
    "손을 떼는 순간 확정됩니다. 아직 둘러싸지 못한 선은 그대로 남아 있으니 이어서 더 그으면 되고, 그은 선 위로 되돌아가면 그만큼 지워집니다. 처음부터 다시 그리려면 '지우기'를 누르세요.",
    `한 차례에 그을 수 있는 선은 ${TERRITORY_MAX_LINE}칸까지입니다. 얼마나 알뜰하게 둘러싸느냐가 이 게임의 승부처입니다.`,
    "상대 땅에 맞닿은 격자선이나 이미 누군가의 땅 한가운데로는 지나갈 수 없고, 그은 선끼리 겹칠 수도 없습니다. 규칙에 어긋나는 선은 확정되지 않을 뿐, 차례를 잃지는 않습니다.",
    "더 이상 둘러쌀 곳이 없는 쪽은 차례를 건너뛰고, 양쪽 모두 둘러쌀 곳이 없으면 게임이 끝납니다. 차지한 칸이 더 많은 쪽이 승리하고, 같으면 무승부입니다.",
  ],
};
