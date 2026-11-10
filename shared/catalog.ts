export const AVATARS = [
  { id: '01-cat', name: 'Кот' },
  { id: '02-corgi', name: 'Корги' },
  { id: '03-fox', name: 'Лиса' },
  { id: '04-frog', name: 'Лягушка' },
  { id: '05-panda', name: 'Панда' },
  { id: '06-robot', name: 'Робот' },
  { id: '07-cap', name: 'Кепка' },
  { id: '08-pink', name: 'Розовые волосы' },
  { id: '09-curls', name: 'Кудри' },
  { id: '10-astronaut', name: 'Космонавт' },
  { id: '12-poop-dog', name: 'Пёс с мухами' },
  { id: '11-octopus', name: 'Осьминог в жёлтых очках' },
] as const;

export type AvatarId = (typeof AVATARS)[number]['id'];
export const avatarUrl = (id: string) => `/avatars/${id}.webp`;
export const isAvatarId = (id: unknown): id is AvatarId =>
  AVATARS.some((avatar) => avatar.id === id);

export const DEFAULT_COMMON_WORDS = [
  'Кот в кадре', 'Техническая пауза', 'Пора за чаем',
  'Кто-то чихнул', 'Бинго!', 'Громкий смех',
  'Дверной звонок', 'Пропал звук', 'Все на месте',
];

export const MAX_PLAYERS = 4;
export const MIN_PLAYERS = 1;
export const MAX_NAME_LENGTH = 24;
export const MAX_PHRASE_LENGTH = 60;
