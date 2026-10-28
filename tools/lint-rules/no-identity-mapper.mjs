/**
 * `creativo/no-identity-mapper` — no no-op mappers (Law 5 zero-mapper,
 * Law 3 zero inbound mapping, Law 1). A document, a wire answer and a
 * struct share ONE flat layout, so a function that copies a value into the
 * type it already has does nothing but allocate, and a function that only
 * calls another one under a new name is a second spelling of it. Three
 * reports, all syntactic (the repo has no typed linting):
 *
 * `identityCopy` — a function (declaration, expression, arrow, method,
 * companion member or class member) when ALL of these hold:
 *   - it has exactly one parameter P: an identifier, or an object pattern
 *     of shorthand identifiers (no default, no rename);
 *   - its body is an expression, or a block of zero or more
 *     `const { a, b } = P;` (shorthand, no default, no rename) followed by
 *     one `return`;
 *   - the returned value, through `satisfies T` and `as const` (no other
 *     cast), is an object literal with at least one property, each one
 *     `k: P.k` (same non-computed name), a shorthand `k` bound from P, or
 *     `...P`;
 *   - and either P's type annotation equals the declared return type
 *     (text, whitespace removed) or the object is exactly `{ ...P }`.
 *   No name is exempt: a projection states itself in its signature
 *   (`<T extends X>(value: T): X`), which this rule never reports.
 *
 * `localizedCopy` — an object literal of exactly `en: S.en` and `bg: S.bg`
 * (either order, the same source S). `LocalizedText` is closed, so this is
 * always an identity copy: pass S as it is.
 *
 * `forwarder` — a function whose whole body is one call to another
 * function with its own parameters, unchanged and in order:
 *   - scope: a module-level function declaration; a module-level `const`
 *     with no type annotation whose init is an arrow or function
 *     expression (a typed `const f: ObserveBusyDay = …` is a port
 *     implementation, out); a property or method of an object literal that
 *     is (through `as const` / `satisfies`) the init of such a `const` (a
 *     companion); a `private` / `#private` class member (a template cannot
 *     reach it — public and protected members are template bridges, out);
 *   - parameters: plain identifiers, no default (that is partial
 *     application) and no pattern; the last may be `...rest`;
 *   - body: one call — an expression body or a lone `return`, an `await`
 *     unwrapped — never optional (`?.`), never with explicit type
 *     arguments (`of<T>(x)` binds a type), never behind `as`, `satisfies`
 *     or `!`;
 *   - callee: an identifier or a non-computed member chain rooted at an
 *     identifier that resolves, across every definition of the name (a
 *     companion's type alias and value share one variable), to an import,
 *     a module-level function, or a module-level variable initialised by
 *     an object literal or a function. Globals (`Object`, `Math`) and
 *     receivers built otherwise (`new Intl.Collator()`, a regex, a call
 *     result) keep their `this` binding and are out;
 *   - arguments: exactly the parameters, same count and order; a rest
 *     parameter matches a trailing spread of the same name. Zero
 *     parameters with zero arguments is a forward.
 *
 * A name that states a distinct domain rule the target happens to compute
 * today (KEEP-DOMAIN-ALIAS) keeps a justified
 * `// eslint-disable-next-line creativo/no-identity-mapper -- <the rule>`;
 * the report sits on the declaration's first line (the name).
 *
 * Known limits — review rules, not reported:
 *   - projections through a `switch` or through factories;
 *   - a default-parameter partial application;
 *   - argument unpack or reorder (`options.complete`, `(b, a)`);
 *   - local aliases nested inside a function
 *     (`const t = (k, p) => translate(k, p)`);
 *   - eta-expanded members of objects built inside a factory
 *     (`({ m: (x) => g.m(x) })`);
 *   - public Angular members;
 *   - a copy into a NARROWER type (`drawOf`), which needs type information.
 */

/** The wrappers `identityCopy` sees through: `satisfies T` and `as const`. */
function unwrapCopy(node) {
  let current = node;
  for (;;) {
    if (current.type === 'TSSatisfiesExpression') {
      current = current.expression;
    } else if (
      current.type === 'TSAsExpression' &&
      current.typeAnnotation.type === 'TSTypeReference' &&
      current.typeAnnotation.typeName.type === 'Identifier' &&
      current.typeAnnotation.typeName.name === 'const'
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** The wrappers a companion's init may sit behind: `as const`, `satisfies T`. */
function unwrapInit(node) {
  let current = node;
  while (
    current !== null &&
    (current.type === 'TSAsExpression' ||
      current.type === 'TSSatisfiesExpression')
  ) {
    current = current.expression;
  }
  return current;
}

/** A non-computed key's name (`a`, `'a'`), or null. */
function keyName(property) {
  if (property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  if (
    property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
  ) {
    return property.key.value;
  }
  return null;
}

/** Whether `pattern` is `{ a, b }`: shorthand identifiers only, no default, no rest. */
function isShorthandPattern(pattern) {
  return (
    pattern.type === 'ObjectPattern' &&
    pattern.properties.every(
      (property) =>
        property.type === 'Property' &&
        property.shorthand &&
        !property.computed &&
        property.value.type === 'Identifier',
    )
  );
}

/** The type annotation's text without whitespace, or null. */
function typeText(sourceCode, annotated) {
  const annotation = annotated?.typeAnnotation ?? annotated?.returnType;
  if (annotation === undefined || annotation === null) return null;
  return sourceCode.getText(annotation.typeAnnotation).replace(/\s+/g, '');
}

/** The returned expression of a function body, with the names bound from P on the way, or null. */
function copyBody(fn, parameter) {
  if (fn.body.type !== 'BlockStatement') {
    return { returned: fn.body, bound: new Set() };
  }
  const statements = fn.body.body;
  if (statements.length === 0) return null;
  const last = statements[statements.length - 1];
  if (last.type !== 'ReturnStatement' || last.argument === null) return null;
  const bound = new Set();
  for (const statement of statements.slice(0, -1)) {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      parameter.type !== 'Identifier'
    ) {
      return null;
    }
    for (const declarator of statement.declarations) {
      if (
        !isShorthandPattern(declarator.id) ||
        declarator.init === null ||
        declarator.init.type !== 'Identifier' ||
        declarator.init.name !== parameter.name
      ) {
        return null;
      }
      for (const property of declarator.id.properties) {
        bound.add(property.value.name);
      }
    }
  }
  return { returned: last.argument, bound };
}

/** Whether `fn` copies its one parameter into the type it already has. */
function isIdentityCopy(sourceCode, fn) {
  if (fn.params.length !== 1) return null;
  const [parameter] = fn.params;
  if (parameter.type !== 'Identifier' && !isShorthandPattern(parameter)) {
    return null;
  }
  const body = copyBody(fn, parameter);
  if (body === null) return null;
  const bound = body.bound;
  if (parameter.type === 'ObjectPattern') {
    for (const property of parameter.properties) {
      bound.add(property.value.name);
    }
  }
  const object = unwrapCopy(body.returned);
  if (object.type !== 'ObjectExpression' || object.properties.length === 0) {
    return null;
  }
  const source = parameter.type === 'Identifier' ? parameter.name : null;
  for (const property of object.properties) {
    if (property.type === 'SpreadElement') {
      if (
        source === null ||
        property.argument.type !== 'Identifier' ||
        property.argument.name !== source
      ) {
        return null;
      }
      continue;
    }
    if (property.kind !== 'init' || property.method) return null;
    const name = keyName(property);
    if (name === null) return null;
    if (property.shorthand) {
      if (!bound.has(name)) return null;
      continue;
    }
    const value = property.value;
    if (
      source === null ||
      value.type !== 'MemberExpression' ||
      value.computed ||
      value.optional ||
      value.object.type !== 'Identifier' ||
      value.object.name !== source ||
      value.property.type !== 'Identifier' ||
      value.property.name !== name
    ) {
      return null;
    }
  }
  const sameType =
    typeText(sourceCode, parameter) !== null &&
    typeText(sourceCode, parameter) === typeText(sourceCode, fn);
  const bareClone =
    object.properties.length === 1 &&
    object.properties[0].type === 'SpreadElement';
  return sameType || bareClone ? object : null;
}

/** Whether `object` is `{ en: S.en, bg: S.bg }` (either order, one source). */
function isLocalizedCopy(sourceCode, object) {
  if (object.properties.length !== 2) return false;
  const sources = new Set();
  const keys = new Set();
  for (const property of object.properties) {
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.method ||
      property.shorthand
    ) {
      return false;
    }
    const name = keyName(property);
    if (name !== 'en' && name !== 'bg') return false;
    const value = property.value;
    if (
      value.type !== 'MemberExpression' ||
      value.computed ||
      value.optional ||
      value.property.type !== 'Identifier' ||
      value.property.name !== name
    ) {
      return false;
    }
    keys.add(name);
    sources.add(sourceCode.getText(value.object));
  }
  return keys.size === 2 && sources.size === 1;
}

/** Whether `node` (a declaration or a declarator's statement) sits at module level. */
function isModuleLevel(statement) {
  const parent = statement.parent;
  if (parent.type === 'Program') return true;
  return (
    (parent.type === 'ExportNamedDeclaration' ||
      parent.type === 'ExportDefaultDeclaration') &&
    parent.parent.type === 'Program'
  );
}

/** Whether `declarator` is a module-level `const` with no type annotation. */
function isUntypedModuleConst(declarator) {
  return (
    declarator.type === 'VariableDeclarator' &&
    declarator.id.type === 'Identifier' &&
    declarator.id.typeAnnotation === undefined &&
    declarator.parent.kind === 'const' &&
    isModuleLevel(declarator.parent)
  );
}

/**
 * Where a function sits, when the `forwarder` scope reaches it: the node
 * the report anchors to and the name it is reported under, or null.
 */
function forwarderHolder(fn) {
  const parent = fn.parent;
  if (fn.type === 'FunctionDeclaration') {
    return isModuleLevel(fn)
      ? { node: fn, name: fn.id?.name ?? 'default' }
      : null;
  }
  if (parent.type === 'VariableDeclarator') {
    return parent.init === fn && isUntypedModuleConst(parent)
      ? { node: parent, name: parent.id.name }
      : null;
  }
  if (parent.type === 'Property' && parent.value === fn) {
    let holder = parent.parent;
    while (
      holder.parent.type === 'TSAsExpression' ||
      holder.parent.type === 'TSSatisfiesExpression'
    ) {
      holder = holder.parent;
    }
    const declarator = holder.parent;
    if (
      parent.parent.type === 'ObjectExpression' &&
      declarator.type === 'VariableDeclarator' &&
      declarator.init === holder &&
      isUntypedModuleConst(declarator)
    ) {
      return {
        node: parent,
        name: `${declarator.id.name}.${keyName(parent) ?? '[computed]'}`,
      };
    }
    return null;
  }
  if (
    (parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    parent.value === fn &&
    (parent.accessibility === 'private' ||
      parent.key.type === 'PrivateIdentifier')
  ) {
    const name =
      parent.key.type === 'PrivateIdentifier'
        ? `#${parent.key.name}`
        : (keyName(parent) ?? '[computed]');
    return { node: parent, name };
  }
  return null;
}

/** The one call a function's body is, or null. */
function onlyCall(fn) {
  let expression;
  if (fn.body.type === 'BlockStatement') {
    const statements = fn.body.body;
    if (
      statements.length !== 1 ||
      statements[0].type !== 'ReturnStatement' ||
      statements[0].argument === null
    ) {
      return null;
    }
    expression = statements[0].argument;
  } else {
    expression = fn.body;
  }
  if (expression.type === 'AwaitExpression') expression = expression.argument;
  if (expression.type !== 'CallExpression') return null;
  if (expression.optional) return null;
  if (expression.typeArguments ?? expression.typeParameters) return null;
  return expression;
}

/** The root identifier of a plain callee (`f`, `A.b.c`), or null. */
function calleeRoot(callee) {
  let current = callee;
  while (current.type === 'MemberExpression') {
    if (current.computed || current.optional) return null;
    current = current.object;
  }
  return current.type === 'Identifier' ? current : null;
}

/** Whether a variable definition is an import, a module function, or a module companion / function value. */
function isForwardTarget(definition) {
  if (definition.type === 'ImportBinding') return true;
  if (definition.type === 'FunctionName') {
    return isModuleLevel(definition.node);
  }
  if (definition.type === 'Variable') {
    const declarator = definition.node;
    if (
      declarator.type !== 'VariableDeclarator' ||
      !isModuleLevel(declarator.parent)
    ) {
      return false;
    }
    const init = unwrapInit(declarator.init);
    return (
      init !== null &&
      (init.type === 'ObjectExpression' ||
        init.type === 'ArrowFunctionExpression' ||
        init.type === 'FunctionExpression')
    );
  }
  return false;
}

/** The variable `identifier` resolves to, walking out from its scope, or null. */
function resolve(sourceCode, identifier) {
  let scope = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/** Whether the call passes exactly the function's parameters, in order. */
function passesOwnParameters(fn, call) {
  if (call.arguments.length !== fn.params.length) return false;
  return fn.params.every((parameter, index) => {
    const argument = call.arguments[index];
    if (parameter.type === 'Identifier') {
      return argument.type === 'Identifier' && argument.name === parameter.name;
    }
    if (
      parameter.type === 'RestElement' &&
      index === fn.params.length - 1 &&
      parameter.argument.type === 'Identifier'
    ) {
      return (
        argument.type === 'SpreadElement' &&
        argument.argument.type === 'Identifier' &&
        argument.argument.name === parameter.argument.name
      );
    }
    return false;
  });
}

/** The callee a forwarder only calls, or null. */
function forwardedCallee(sourceCode, fn) {
  const call = onlyCall(fn);
  if (call === null) return null;
  const root = calleeRoot(call.callee);
  if (root === null) return null;
  if (!passesOwnParameters(fn, call)) return null;
  const variable = resolve(sourceCode, root);
  if (variable === null || variable.defs.length === 0) return null;
  const scopeType = variable.scope.type;
  if (scopeType !== 'module' && scopeType !== 'global') return null;
  if (!variable.defs.some(isForwardTarget)) return null;
  return sourceCode.getText(call.callee);
}

/** The name a function is known by, for the `identityCopy` message. */
function functionName(fn) {
  if (fn.id) return fn.id.name;
  const parent = fn.parent;
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  if (
    parent.type === 'Property' ||
    parent.type === 'MethodDefinition' ||
    parent.type === 'PropertyDefinition'
  ) {
    if (parent.key.type === 'PrivateIdentifier') return `#${parent.key.name}`;
    return keyName(parent) ?? '(computed)';
  }
  return '(anonymous)';
}

/** The node an `identityCopy` report anchors to: the declaration's name line. */
function copyAnchor(fn) {
  const parent = fn.parent;
  if (
    (parent.type === 'VariableDeclarator' ||
      parent.type === 'Property' ||
      parent.type === 'MethodDefinition' ||
      parent.type === 'PropertyDefinition') &&
    (parent.init === fn || parent.value === fn)
  ) {
    return parent;
  }
  return fn;
}

export const noIdentityMapper = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Law 5 zero-mapper, Law 3 zero inbound mapping: no function that copies its argument into the type it already has, no `LocalizedText` copied field by field, no module function or companion member that only forwards its arguments.',
    },
    schema: [],
    messages: {
      identityCopy:
        '`{{name}}` copies its argument into the type it already has — a no-op mapper (Law 5 zero-mapper, Law 3 zero inbound mapping). Use the value as it is; a projection declares the wider value it cuts a slice from (`<T extends X>(value: T): X`).',
      localizedCopy:
        '`{ en: {{source}}.en, bg: {{source}}.bg }` copies a `LocalizedText` field by field — pass `{{source}}` as it is.',
      forwarder:
        '`{{name}}` only calls `{{callee}}` with its own arguments — a renamed alias. Call `{{callee}}` directly, or list the function in its companion by shorthand. A name that states a distinct domain rule keeps a justified `eslint-disable-next-line creativo/no-identity-mapper -- <the rule>`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    /** Objects already reported as an identity copy (no second report as a `LocalizedText` copy). */
    const copied = new WeakSet();

    function onFunction(fn) {
      const object = isIdentityCopy(sourceCode, fn);
      if (object !== null) {
        copied.add(object);
        context.report({
          node: copyAnchor(fn),
          messageId: 'identityCopy',
          data: { name: functionName(fn) },
        });
        return;
      }
      const holder = forwarderHolder(fn);
      if (holder === null) return;
      const callee = forwardedCallee(sourceCode, fn);
      if (callee === null) return;
      context.report({
        node: holder.node,
        messageId: 'forwarder',
        data: { name: holder.name, callee },
      });
    }

    return {
      FunctionDeclaration: onFunction,
      FunctionExpression: onFunction,
      ArrowFunctionExpression: onFunction,
      'ObjectExpression:exit'(object) {
        if (copied.has(object) || !isLocalizedCopy(sourceCode, object)) return;
        const [first] = object.properties;
        context.report({
          node: object,
          messageId: 'localizedCopy',
          data: { source: sourceCode.getText(first.value.object) },
        });
      },
    };
  },
};
