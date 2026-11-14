import type { Language } from "@sculptr/sdk";

export interface Text {
  status: {
    waiting: string;
    ready: string;
    airborne: string;
    placed: string;
    cancelled: string;
  };
  unsupported: string;
  controls: string;
  place: string;
  remove: string;
}

const en: Text = {
  status: {
    waiting: "Waiting for a save...",
    ready: "Ready",
    airborne: "Airborne",
    placed: "Placed",
    cancelled: "Cancelled",
  },
  unsupported: "Not supported",
  controls: "Controls",
  place: "Place a quicksave",
  remove: "Remove it",
};

const TEXT: Record<Language, Text> = {
  en,
  "zh-CN": {
    status: {
      waiting: "等待存档…",
      ready: "就绪",
      airborne: "在空中",
      placed: "已放置",
      cancelled: "已取消",
    },
    unsupported: "不支持",
    controls: "操作",
    place: "放置快速存档",
    remove: "移除快速存档",
  },
  ja: {
    status: {
      waiting: "セーブ待ち…",
      ready: "準備完了",
      airborne: "空中",
      placed: "設置済み",
      cancelled: "キャンセル済み",
    },
    unsupported: "非対応",
    controls: "操作キー",
    place: "クイックセーブを置く",
    remove: "クイックセーブを消す",
  },
  ko: {
    status: {
      waiting: "세이브 대기 중…",
      ready: "준비 완료",
      airborne: "공중",
      placed: "놓았어요",
      cancelled: "취소했어요",
    },
    unsupported: "지원하지 않아요",
    controls: "조작 키",
    place: "퀵세이브 놓기",
    remove: "퀵세이브 지우기",
  },
  es: {
    status: {
      waiting: "Esperando un guardado...",
      ready: "Listo",
      airborne: "En el aire",
      placed: "Colocado",
      cancelled: "Cancelado",
    },
    unsupported: "No compatible",
    controls: "Controles",
    place: "Colocar un guardado rápido",
    remove: "Quitar el guardado",
  },
  "pt-BR": {
    status: {
      waiting: "Esperando um save...",
      ready: "Pronto",
      airborne: "No ar",
      placed: "Colocado",
      cancelled: "Cancelado",
    },
    unsupported: "Sem suporte",
    controls: "Controles",
    place: "Colocar um save rápido",
    remove: "Remover o save",
  },
  de: {
    status: {
      waiting: "Warten auf Speicherpunkt...",
      ready: "Bereit",
      airborne: "In der Luft",
      placed: "Gesetzt",
      cancelled: "Abgebrochen",
    },
    unsupported: "Nicht unterstützt",
    controls: "Steuerung",
    place: "Schnellspeicher setzen",
    remove: "Schnellspeicher entfernen",
  },
  fr: {
    status: {
      waiting: "En attente d'une sauvegarde...",
      ready: "Prêt",
      airborne: "En l'air",
      placed: "Posée",
      cancelled: "Annulée",
    },
    unsupported: "Non pris en charge",
    controls: "Commandes",
    place: "Poser une sauvegarde rapide",
    remove: "Enlever la sauvegarde",
  },
  it: {
    status: {
      waiting: "In attesa di un salvataggio...",
      ready: "Pronto",
      airborne: "In aria",
      placed: "Posizionato",
      cancelled: "Annullato",
    },
    unsupported: "Non supportato",
    controls: "Comandi",
    place: "Posiziona un salvataggio rapido",
    remove: "Rimuovi il salvataggio",
  },
  ru: {
    status: {
      waiting: "Ожидание сохранения...",
      ready: "Готово",
      airborne: "В воздухе",
      placed: "Поставлено",
      cancelled: "Отменено",
    },
    unsupported: "Не поддерживается",
    controls: "Управление",
    place: "Поставить быстрое сохранение",
    remove: "Убрать сохранение",
  },
  pl: {
    status: {
      waiting: "Czekam na zapis...",
      ready: "Gotowy",
      airborne: "W powietrzu",
      placed: "Postawiony",
      cancelled: "Anulowany",
    },
    unsupported: "Nieobsługiwane",
    controls: "Sterowanie",
    place: "Postaw szybki zapis",
    remove: "Usuń go",
  },
};

export function text(language: Language): Text {
  return (TEXT as Partial<Record<string, Text>>)[language] ?? en;
}
