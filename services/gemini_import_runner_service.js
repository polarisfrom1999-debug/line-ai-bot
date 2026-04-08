'use strict';

const geminiDispatchService = require('./gemini_dispatch_service');

function buildSchemaForName(schemaName = 'generic_import_v1') {
  switch (schemaName) {
    case 'lab_import_v1':
      return {
        type: 'object',
        properties: {
          document_type: { type: 'string' },
          session_summary: { type: 'string' },
          tables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dates: { type: 'array', items: { type: 'string' } },
                rows: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      unit: { type: 'string' },
                      values_by_date: { type: 'object' }
                    }
                  }
                }
              }
            }
          },
          issues: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' }
        }
      };
    case 'meal_import_v1':
      return {
        type: 'object',
        properties: {
          meal_summary: { type: 'string' },
          items: { type: 'array', items: { type: 'object' } },
          totals: { type: 'object' },
          issues: { type: 'array', items: { type: 'string' } }
        }
      };
    case 'movement_import_v1':
      return {
        type: 'object',
        properties: {
          clip_roles: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
          findings: { type: 'object' },
          coach_cues: { type: 'array', items: { type: 'string' } },
          drills: { type: 'array', items: { type: 'string' } },
          needs_more_views: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number' }
        }
      };
    default:
      return { type: 'object', properties: {} };
  }
}

async function runStructured({ prompt, attachments, schemaName }) {
  const mediaPayloads = Array.isArray(attachments) ? attachments.filter((a) => a?.buffer) : [];
  const schema = buildSchemaForName(schemaName);
  const result = await geminiDispatchService.generateStructuredMediaJson({
    prompt,
    schema,
    mediaPayloads,
    domain: schemaName || 'generic_import'
  });
  return result?.json || null;
}

module.exports = {
  runStructured,
  buildSchemaForName,
};
