import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CollectionConfig } from 'payload';
import { videoDirectory } from '../cabinet/config';
import { cabinetAdmin } from './LearningGroups';

/** Private original videos and their publication metadata; packaged files use separate storage. */
export const Lectures: CollectionConfig = {
  slug: 'lectures',
  labels: { singular: 'Лекция', plural: 'Лекции' },
  admin: {
    useAsTitle: 'title',
    group: 'Личный кабинет',
    defaultColumns: ['title', 'groups', 'products', 'published', 'processingStatus'],
  },
  access: { read: cabinetAdmin, create: cabinetAdmin, update: cabinetAdmin, delete: cabinetAdmin },
  upload: {
    staticDir: path.join(videoDirectory(), 'sources'),
    mimeTypes: ['video/mp4'],
    filesRequiredOnCreate: true,
  },
  hooks: {
    // Replacing a source invalidates every issued URL and encryption key for the old revision.
    beforeChange: [
      ({ data, req }) => {
        if (req.file)
          return {
            ...data,
            revision: randomUUID(),
            processingStatus: 'pending',
            processingProgress: 0,
            processingError: null,
          };
        return data;
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', label: 'Название', required: true },
    { name: 'speaker', type: 'text', label: 'Преподаватель' },
    { name: 'description', type: 'textarea', label: 'Описание' },
    { name: 'sortOrder', type: 'number', label: 'Порядок', defaultValue: 0 },
    {
      name: 'groups',
      type: 'relationship',
      relationTo: 'learning-groups',
      hasMany: true,
      label: 'Доступ для групп',
      admin: {
        description:
          'Доступ участникам любой выбранной группы или покупателям выбранных тарифов и факультативов.',
      },
    },
    {
      name: 'products',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Доступ по тарифам и факультативам',
      admin: {
        description:
          'Доступ при наличии оплаченного заказа с любым выбранным тарифом или факультативом. Заказ должен быть привязан к аккаунту Telegram и не находиться в корзине. Без групп и покупок лекция недоступна.',
      },
    },
    {
      name: 'processingJob',
      type: 'text',
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
    {
      name: 'processingProgress',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 100,
      label: 'Подготовка, %',
      access: { update: ({ req }) => Boolean(req.context.lectureWorker) },
      admin: { hidden: true },
    },
    { name: 'published', type: 'checkbox', label: 'Опубликована', defaultValue: false },
    {
      name: 'processingStatus',
      type: 'select',
      label: 'Подготовка видео',
      defaultValue: 'pending',
      required: true,
      options: [
        { label: 'В очереди', value: 'pending' },
        { label: 'Обрабатывается', value: 'processing' },
        { label: 'Готово', value: 'ready' },
        { label: 'Ошибка', value: 'failed' },
      ],
      access: { update: ({ req }) => Boolean(req.context.lectureWorker) },
      admin: {
        readOnly: true,
        components: { Field: '/components/LectureProgress#LectureProgress' },
      },
    },
    {
      name: 'processingError',
      type: 'text',
      label: 'Ошибка подготовки',
      admin: { readOnly: true },
      access: { update: ({ req }) => Boolean(req.context.lectureWorker) },
    },
    {
      name: 'revision',
      type: 'text',
      label: 'Версия видео',
      admin: { hidden: true },
      access: { read: () => false, update: () => false },
    },
  ],
};
