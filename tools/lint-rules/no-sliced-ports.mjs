/**
 * `creativo/no-sliced-ports` — Law 9 (bottom-up port composition): a port
 * bundle is never carved out of a larger one with `Pick`/`Omit`. Focused
 * bundles are concrete record types declared in `libs/ecs-core/src/ports/`,
 * 1:1 with an Angular `InjectionToken` or a functions adapter factory, and
 * every aggregate is their intersection (`&`). A consumer that needs a
 * subset no bundle names has found a missing bundle — split it in the port
 * file, never slice at the use site.
 *
 * Reported everywhere: `Pick<…, …>` / `Omit<…, …>` whose sliced type names a
 * `*Ports` type (alone, qualified, or anywhere inside an intersection,
 * union or parenthesised type) — `Pick<SchedulingPorts, 'loadPolicy'>`,
 * `Omit<AppointmentPhotoPorts, 'uploadPhotoBytes'>`.
 *
 * Option `{ anyType: true }` — installed on `libs/ecs-core/src/ports/**`
 * only — reports EVERY `Pick`/`Omit` there, over entities and data too:
 * the ports tier names its argument shapes (`AppointmentPhotoFacts`,
 * `AccountContact`) instead of carving them with string keys.
 */

const SLICERS = new Set(['Pick', 'Omit']);
const PORTS_NAME = /Ports$/;

/** The rightmost identifier of a type name (`A.B.CPorts` → `CPorts`). */
function rightmostName(typeName) {
  if (typeName.type === 'Identifier') return typeName.name;
  if (typeName.type === 'TSQualifiedName') return typeName.right.name;
  return null;
}

/** Does this type node name a `*Ports` type anywhere in its composition? */
function namesPorts(node) {
  if (!node) return false;
  switch (node.type) {
    case 'TSTypeReference': {
      const name = rightmostName(node.typeName);
      return name !== null && PORTS_NAME.test(name);
    }
    case 'TSIntersectionType':
    case 'TSUnionType':
      return node.types.some(namesPorts);
    case 'TSParenthesizedType':
      return namesPorts(node.typeAnnotation);
    default:
      return false;
  }
}

export const noSlicedPorts = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 9: compose port bundles bottom-up with `&`; never slice them with Pick/Omit.',
    },
    schema: [
      {
        type: 'object',
        properties: { anyType: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      slicedPorts:
        'Law 9: `{{slicer}}<{{target}}, …>` slices a port bundle. Depend on a named bundle or an `&` of bundles; a subset no bundle names is a missing bundle — declare it in libs/ecs-core/src/ports/.',
      slicedInPorts:
        'Law 9: no `{{slicer}}` in the ports tier — name the shape (a bundle record, or a slice type in components/entities) instead of carving it with string keys.',
    },
  },
  create(context) {
    const anyType = context.options[0]?.anyType === true;
    return {
      TSTypeReference(node) {
        const slicer = rightmostName(node.typeName);
        if (!slicer || !SLICERS.has(slicer)) return;
        const args = node.typeArguments ?? node.typeParameters;
        const target = args?.params?.[0];
        if (namesPorts(target)) {
          context.report({
            node,
            messageId: 'slicedPorts',
            data: {
              slicer,
              target: context.sourceCode.getText(target),
            },
          });
          return;
        }
        if (anyType) {
          context.report({
            node,
            messageId: 'slicedInPorts',
            data: { slicer },
          });
        }
      },
    };
  },
};
