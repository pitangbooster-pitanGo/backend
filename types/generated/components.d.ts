import type { Schema, Struct } from '@strapi/strapi';

export interface TaskMaterial extends Struct.ComponentSchema {
  collectionName: 'components_task_materials';
  info: {
    description: 'Material de apoio vinculado a uma tarefa';
    displayName: 'Material';
  };
  attributes: {
    description: Schema.Attribute.Text;
    external_url: Schema.Attribute.String;
    file: Schema.Attribute.Media<'files' | 'videos'>;
    material_type: Schema.Attribute.Enumeration<
      ['link', 'pdf', 'document', 'video', 'file']
    > &
      Schema.Attribute.Required;
    order_index: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'task.material': TaskMaterial;
    }
  }
}
