import type { Block, CollectionConfig } from 'payload';

import { refreshCommandMenu } from '../bot/commands';

/** Longest pause between steps; the scenario holds the bot's handler while it waits. */
export const MAX_PAUSE_SECONDS = 30;

/** A message with optional buttons under it. */
const MessageStep: Block = {
  slug: 'message',
  labels: { singular: 'Сообщение', plural: 'Сообщения' },
  fields: [
    {
      name: 'text',
      type: 'textarea',
      label: 'Текст',
      required: true,
      admin: {
        description:
          'Подстановки: {name} — имя в Telegram, {site} — адрес сайта, {contact} — email для связи.',
      },
    },
    {
      name: 'buttons',
      type: 'array',
      label: 'Кнопки',
      labels: { singular: 'Кнопка', plural: 'Кнопки' },
      fields: [
        { name: 'label', type: 'text', label: 'Надпись', required: true },
        {
          name: 'action',
          type: 'select',
          label: 'Что делает',
          required: true,
          defaultValue: 'scenario',
          options: [
            { label: 'Запускает другой сценарий', value: 'scenario' },
            { label: 'Открывает ссылку', value: 'url' },
          ],
        },
        {
          name: 'scenario',
          type: 'relationship',
          relationTo: 'scenarios',
          label: 'Сценарий',
          admin: { condition: (_, button) => button?.action === 'scenario' },
        },
        {
          name: 'url',
          type: 'text',
          label: 'Ссылка',
          admin: { condition: (_, button) => button?.action === 'url' },
          validate: (
            value: string | null | undefined,
            { siblingData }: { siblingData: { action?: string } },
          ) =>
            siblingData.action !== 'url' ||
            /^https?:\/\/\S+$/.test(value ?? '') ||
            'Нужна ссылка вида https://…',
        },
      ],
    },
  ],
};

/** What the member bought, with the buttons to join the chats. */
const OrderSummaryStep: Block = {
  slug: 'orderSummary',
  labels: { singular: 'Состав заказа и чаты', plural: 'Состав заказа и чаты' },
  // Texts come from "Тексты бота": the summary itself and the line above the chat buttons.
  fields: [],
};

/** Join buttons for every chat the member may enter. */
const ChatButtonsStep: Block = {
  slug: 'chatButtons',
  labels: { singular: 'Кнопки чатов', plural: 'Кнопки чатов' },
  fields: [
    {
      name: 'text',
      type: 'textarea',
      label: 'Текст над кнопками',
      required: true,
      defaultValue: 'Вступите в чаты программы по кнопкам ниже.',
    },
  ],
};

/** A pause before the next step, e.g. so two messages do not arrive at once. */
const PauseStep: Block = {
  slug: 'pause',
  labels: { singular: 'Пауза', plural: 'Паузы' },
  fields: [
    {
      name: 'seconds',
      type: 'number',
      label: 'Секунд',
      required: true,
      min: 1,
      max: MAX_PAUSE_SECONDS,
      defaultValue: 3,
    },
  ],
};

/**
 * Bot scenarios the organizers build themselves: a chain of steps started by a command,
 * a button, the bare /start or a confirmed purchase.
 */
export const Scenarios: CollectionConfig = {
  slug: 'scenarios',
  labels: { singular: 'Сценарий', plural: 'Сценарии' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'command', 'audience', 'runOnStart', 'runAfterPurchase'],
    description:
      'Цепочки сообщений бота. Сценарий запускается командой, кнопкой из другого сценария, ' +
      'по /start или после подтверждения оплаты.',
  },
  hooks: {
    // The command menu in Telegram lists the scenarios with commands.
    afterChange: [({ req }) => void refreshCommandMenu(req.payload)],
    afterDelete: [({ req }) => void refreshCommandMenu(req.payload)],
  },
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    {
      type: 'row',
      fields: [
        {
          name: 'command',
          type: 'text',
          label: 'Команда',
          unique: true,
          admin: {
            description: 'Без «/», латиницей, например faq. Пусто — запуск только кнопкой.',
          },
          validate: (value: string | null | undefined) =>
            !value ||
            (/^[a-z0-9_]{1,32}$/.test(value) && value !== 'start') ||
            'Латинские буквы, цифры и «_», до 32 символов; start занята ботом',
        },
        {
          name: 'commandDescription',
          type: 'text',
          label: 'Описание в меню команд',
          admin: { condition: (data) => Boolean(data?.command) },
        },
      ],
    },
    {
      name: 'audience',
      type: 'select',
      label: 'Кому доступен',
      required: true,
      defaultValue: 'all',
      options: [
        { label: 'Всем', value: 'all' },
        { label: 'Тем, у кого есть оплаченный заказ', value: 'buyers' },
        { label: 'Купившим определённые тарифы', value: 'products' },
      ],
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Тарифы и факультативы',
      admin: { condition: (data) => data?.audience === 'products' },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'runOnStart',
          type: 'checkbox',
          label: 'Вместо приветствия по /start',
          admin: { description: 'Для тех, у кого ещё нет заказов.' },
        },
        {
          name: 'runAfterPurchase',
          type: 'checkbox',
          label: 'После подтверждения оплаты',
          admin: { description: 'Сразу после сообщения о составе заказа.' },
        },
      ],
    },
    {
      name: 'steps',
      type: 'blocks',
      label: 'Шаги',
      labels: { singular: 'Шаг', plural: 'Шаги' },
      required: true,
      minRows: 1,
      blocks: [MessageStep, ChatButtonsStep, OrderSummaryStep, PauseStep],
    },
  ],
};
