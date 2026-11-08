import type { Access, CollectionConfig } from 'payload';

/** Student cookies never authenticate to Payload; only Payload administrators manage learning data. */
export const cabinetAdmin: Access = ({ req }) => req.user?.collection === 'users';

/** Explicit cohorts with manual membership; logging in never grants a group automatically. */
export const LearningGroups: CollectionConfig = {
  slug: 'learning-groups',
  labels: { singular: 'Учебная группа', plural: 'Учебные группы' },
  admin: { useAsTitle: 'title', group: 'Личный кабинет', defaultColumns: ['title', 'members'] },
  access: { read: cabinetAdmin, create: cabinetAdmin, update: cabinetAdmin, delete: cabinetAdmin },
  fields: [
    { name: 'title', type: 'text', required: true, label: 'Название' },
    {
      name: 'members',
      type: 'relationship',
      relationTo: 'members',
      hasMany: true,
      label: 'Участники',
      admin: {
        description: 'Добавьте участников после их входа через Telegram или обращения к боту.',
      },
    },
  ],
};
