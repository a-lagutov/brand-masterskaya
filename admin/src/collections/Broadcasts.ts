import { APIError, type CollectionConfig } from 'payload';
import { broadcastEndpoints } from '../bot/broadcasts';
import { recipientSelectionEndpoint } from '../bot/recipientSelection';

/** Drafts are editable; recipients and delivery results are written by the dispatcher only. */
export const Broadcasts: CollectionConfig = {
  slug: 'broadcasts',
  labels: { singular: 'Рассылка', plural: 'Рассылки' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'sender', 'status', 'nextRunAt', 'updatedAt'],
    description:
      'Сохраните черновик, проверьте получателей и текст, затем запустите рассылку. Условия фильтра применяются вместе. От бота доступны только пользователи, которые уже запускали бота.',
  },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => (req.user ? { status: { equals: 'draft' } } : false),
    delete: ({ req }) => (req.user ? { status: { equals: 'draft' } } : false),
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (req.context.broadcastInternal) {
          if (
            req.context.broadcastRevision &&
            originalDoc?.updatedAt !== req.context.broadcastRevision
          )
            throw new APIError('Рассылка изменилась. Обновите предпросмотр.', 409);
          return data;
        }
        if (originalDoc?.id && originalDoc.status !== 'draft')
          throw new APIError('Запущенную рассылку нельзя изменить.', 409);
        // Reject API attempts to inject deliveries or bypass the preview and queue endpoints.
        if (
          (data.status && data.status !== 'draft') ||
          data.deliveries != null ||
          data.retryAt != null ||
          ['nextRunAt', 'parentBroadcast', 'occurrenceKey', 'scheduledFor', 'scheduleError'].some(
            (name) => data[name] != null && data[name] !== '',
          )
        )
          throw new APIError('Запустите рассылку кнопкой после предпросмотра.', 400);
        return data;
      },
    ],
  },
  endpoints: [...broadcastEndpoints, recipientSelectionEndpoint],
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    {
      name: 'sender',
      type: 'select',
      label: 'Отправитель',
      required: true,
      defaultValue: 'bot',
      options: [
        { label: 'Бот', value: 'bot' },
        { label: '@brandmasterskaya (личный аккаунт)', value: 'account' },
      ],
    },
    {
      name: 'audience',
      type: 'select',
      label: 'Получатели',
      required: true,
      defaultValue: 'selected',
      options: [
        { label: 'Выбранные участники', value: 'selected' },
        { label: 'Все участники по фильтру', value: 'all' },
      ],
    },
    {
      name: 'payment',
      type: 'select',
      required: true,
      defaultValue: 'all',
      label: 'Оплата',
      options: [
        { label: 'Любая / без заказа', value: 'all' },
        { label: 'Есть оплаченный заказ', value: 'paid' },
        { label: 'Есть неоплаченный заказ', value: 'unpaid' },
      ],
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Тарифы / факультативы',
      admin: {
        description:
          'Пусто — любые. Иначе хотя бы одна выбранная позиция в заказе с выбранным статусом оплаты.',
      },
    },
    {
      name: 'members',
      type: 'relationship',
      relationTo: 'members',
      hasMany: true,
      label: 'Выбранные участники',
      admin: {
        condition: (data) => data.audience === 'selected',
        components: { Field: '/components/RecipientTable#RecipientTable' },
      },
    },
    {
      name: 'orders',
      type: 'relationship',
      relationTo: 'orders',
      hasMany: true,
      label: 'Выбранные заказы',
      admin: {
        components: { Field: '/components/RecipientTable#RecipientTable' },
        condition: (data) => data.audience === 'selected',
        description:
          'Для отправки из личного аккаунта до запуска бота. В заказе нужен Telegram username или телефон из контактов аккаунта.',
      },
    },
    {
      name: 'message',
      type: 'textarea',
      label: 'Текст',
      required: true,
      admin: {
        components: { Field: '/components/BroadcastMessageEditor#BroadcastMessageEditor' },
        description:
          'Ссылка на текст: [Перейти в бота]({bot_link}) или [Сайт](https://example.com). Без HTML. Переменные: {name}, {first_name}, {username}, {email}, {phone}, {bot_link}, {order_id}, {site}. Данные заказа — из последнего подходящего заказа. Персональную ссылку не пересылайте другим людям.',
      },
    },
    {
      name: 'scheduleMode',
      type: 'select',
      label: 'Когда отправлять',
      required: true,
      defaultValue: 'now',
      options: [
        { label: 'Сейчас', value: 'now' },
        { label: 'Один раз по дате', value: 'once' },
        { label: 'Ежедневно', value: 'daily' },
        { label: 'Еженедельно', value: 'weekly' },
        { label: 'Ежемесячно', value: 'monthly' },
      ],
      admin: {
        description:
          'Повторы сохраняют время и день первого запуска по Москве. В коротком месяце используется последний день.',
      },
    },
    {
      name: 'scheduledAt',
      type: 'date',
      label: 'Первый запуск (Москва)',
      admin: {
        condition: (data) => Boolean(data.scheduleMode && data.scheduleMode !== 'now'),
        components: {
          Field: '/components/BroadcastScheduleDate#BroadcastScheduleDate',
          Cell: '/components/BroadcastScheduleDate#BroadcastScheduleDateCell',
        },
      },
    },
    {
      name: 'scheduleUntil',
      type: 'date',
      label: 'Повторять до (включительно, Москва)',
      admin: {
        condition: (data) => ['daily', 'weekly', 'monthly'].includes(data.scheduleMode),
        components: {
          Field: '/components/BroadcastScheduleDate#BroadcastScheduleDate',
          Cell: '/components/BroadcastScheduleDate#BroadcastScheduleDateCell',
        },
        description: 'Пусто — повторять до остановки расписания.',
      },
    },
    {
      name: 'nextRunAt',
      type: 'date',
      label: 'Следующий запуск (Москва)',
      index: true,
      admin: {
        readOnly: true,
        condition: (data) => Boolean(data.nextRunAt),
        components: {
          Field: '/components/BroadcastScheduleDate#BroadcastScheduleDate',
          Cell: '/components/BroadcastScheduleDate#BroadcastScheduleDateCell',
        },
      },
    },
    {
      name: 'scheduleError',
      type: 'text',
      label: 'Причина остановки расписания',
      admin: { readOnly: true, condition: (data) => Boolean(data.scheduleError) },
    },
    {
      name: 'parentBroadcast',
      type: 'relationship',
      relationTo: 'broadcasts',
      index: true,
      label: 'Расписание',
      admin: { readOnly: true, condition: (data) => Boolean(data.parentBroadcast) },
    },
    {
      name: 'scheduledFor',
      type: 'date',
      label: 'Запланированное время этого запуска (Москва)',
      admin: {
        readOnly: true,
        condition: (data) => Boolean(data.parentBroadcast),
        components: {
          Field: '/components/BroadcastScheduleDate#BroadcastScheduleDate',
          Cell: '/components/BroadcastScheduleDate#BroadcastScheduleDateCell',
        },
      },
    },
    {
      name: 'occurrenceKey',
      type: 'text',
      unique: true,
      admin: { hidden: true, readOnly: true },
    },
    {
      name: 'runs',
      type: 'join',
      collection: 'broadcasts',
      on: 'parentBroadcast',
      label: 'История запусков',
      defaultSort: '-scheduledFor',
      admin: {
        allowCreate: false,
        defaultColumns: ['title', 'scheduledFor', 'status'],
        condition: (data) =>
          Boolean(data.scheduleMode && data.scheduleMode !== 'now' && data.status !== 'draft'),
      },
    },
    {
      name: 'status',
      type: 'select',
      label: 'Статус',
      required: true,
      defaultValue: 'draft',
      admin: { readOnly: true },
      options: [
        { label: 'Черновик', value: 'draft' },
        { label: 'Расписание включено', value: 'scheduled' },
        { label: 'Остановлена', value: 'cancelled' },
        { label: 'В очереди', value: 'queued' },
        { label: 'Отправляется', value: 'sending' },
        { label: 'Завершена', value: 'completed' },
      ],
    },
    {
      name: 'retryAt',
      type: 'date',
      label: 'Автоматически продолжится после',
      admin: {
        readOnly: true,
        condition: (data) => Boolean(data.retryAt && data.status === 'sending'),
        description:
          'Telegram ограничил частоту отправки. Обработчик сам продолжит после указанного времени; менять поле не нужно.',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },
    {
      name: 'actions',
      type: 'ui',
      admin: { components: { Field: '/components/BroadcastActions#BroadcastActions' } },
    },
    {
      name: 'deliveries',
      type: 'json',
      label: 'Результаты доставки',
      admin: {
        readOnly: true,
        description:
          'sent — доставлено; failed — ошибка; uncertain — процесс прерван после начала отправки, проверьте диалог перед повторной рассылкой. Автоматического повтора нет.',
      },
    },
  ],
};
