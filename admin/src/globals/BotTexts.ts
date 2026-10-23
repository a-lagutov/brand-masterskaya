import type { GlobalConfig } from 'payload';

const PLACEHOLDERS =
  'Подстановки: {name} — имя, {site} — адрес сайта, {contact} — телефон, Telegram и email из «Настроек сайта».' +
  ' Ссылка: [слова](адрес), например [на сайте]({site}).';

/** The bot's built-in messages; scenarios have their own texts. */
export const BotTexts: GlobalConfig = {
  slug: 'bot-texts',
  label: 'Тексты бота',
  admin: {
    description: 'Сообщения, которые бот отправляет сам. ' + PLACEHOLDERS,
  },
  fields: [
    {
      name: 'start',
      type: 'textarea',
      label: 'Приветствие по /start, если заказов нет',
      required: true,
      defaultValue:
        'Здравствуйте! Это бот программы «Мастерская бренд-стратегии».\n\n' +
        'Оплатить участие можно [на сайте]({site}).\n' +
        'После оплаты откройте бота по кнопке на странице подтверждения заказа ' +
        'или по ссылке из письма.',
      admin: { description: 'Можно заменить сценарием с галочкой «Вместо приветствия по /start».' },
    },
    {
      name: 'paid',
      type: 'textarea',
      label: 'Оплата подтверждена',
      required: true,
      defaultValue:
        'Здравствуйте, {name}! Оплата участия в программе «Мастерская бренд-стратегии» ' +
        'подтверждена ✅\n\nВ заказе:\n{items}\nИтого: {total}',
      admin: { description: 'Ещё подстановки: {items} — позиции заказа, {total} — сумма.' },
    },
    {
      name: 'chats',
      type: 'textarea',
      label: 'Над кнопками чатов',
      required: true,
      defaultValue: 'Вступите в чаты программы по кнопкам ниже — бот сразу одобрит заявку.',
    },
    {
      name: 'chatsLater',
      type: 'textarea',
      label: 'Чатов пока нет',
      required: true,
      defaultValue:
        'Ссылки на чаты программы появятся здесь ближе к старту: просто отправьте боту /start.',
    },
    {
      name: 'notFound',
      type: 'textarea',
      label: 'Заказ не найден',
      required: true,
      defaultValue:
        'Не нашли заказ по этой ссылке. Если вы оплатили участие, напишите нам: {contact}',
    },
    {
      name: 'notPaid',
      type: 'textarea',
      label: 'Заказ ещё не оплачен',
      required: true,
      defaultValue:
        'Банк ещё не подтвердил оплату этого заказа. Попробуйте открыть ссылку через пару минут. ' +
        'Если деньги списались, а оплата не подтверждается, напишите нам: {contact}',
    },
    {
      name: 'otherAccount',
      type: 'textarea',
      label: 'Заказ привязан к другому аккаунту',
      required: true,
      defaultValue:
        'Этот заказ уже привязан к другому аккаунту Telegram. Если это ошибка, напишите нам: {contact}',
    },
    {
      name: 'notAllowed',
      type: 'textarea',
      label: 'Сценарий недоступен',
      required: true,
      defaultValue: 'Эта команда доступна только участникам программы.',
      admin: { description: 'Когда человек запускает сценарий не для него.' },
    },
    {
      name: 'help',
      type: 'textarea',
      label: 'Ответ на непонятное сообщение',
      required: true,
      defaultValue: 'Если остались вопросы, напишите нам: {contact}',
    },
  ],
};
