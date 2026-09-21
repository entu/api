const GUARDS = new Set(['ReturnStatement', 'ContinueStatement', 'BreakStatement'])
const LOOPS = ['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']

// A guard is a bare return/continue/break — the only statement that may follow an `if` without braces.
function isGuard (node) {
  return GUARDS.has(node.type) && !node.argument
}

// Local ESLint rule: guards go inline without braces, every other if/else/loop body gets a braced block, and `--fix` rewrites both.
export default {
  meta: {
    type: 'layout',
    fixable: 'code',
    schema: [],
    messages: {
      inline: '`if (x) {{ guard }}` goes inline without braces.',
      ifBody: 'Only a bare return/continue/break may follow an if without braces — use a block.',
      elseBody: 'An else body must be a braced block.',
      loopBody: 'A loop body must be a braced block.'
    }
  },
  create (context) {
    const sourceCode = context.sourceCode

    // Reports a brace-less body; the fix wraps it and leaves line breaks and indentation to the stylistic rules.
    function requireBlock (body, messageId) {
      if (body.type === 'BlockStatement') return

      context.report({
        node: body,
        messageId,
        fix: (fixer) => fixer.replaceText(body, `{\n${sourceCode.getText(body)}\n}`)
      })
    }

    function checkIf (node) {
      const body = node.consequent

      if (node.alternate && node.alternate.type !== 'IfStatement') {
        requireBlock(node.alternate, 'elseBody')
      }

      if (body.type !== 'BlockStatement') {
        if (!isGuard(body)) {
          requireBlock(body, 'ifBody')
        }

        return
      }

      if (node.alternate || body.body.length !== 1 || !isGuard(body.body.at(0))) return

      const guard = sourceCode.getText(body.body.at(0))

      context.report({
        node: body,
        messageId: 'inline',
        data: { guard },
        fix (fixer) {
          // A comment inside the block would be lost, so that case is left for the developer.
          if (sourceCode.getCommentsInside(body).length > 0) return

          return fixer.replaceText(body, guard)
        }
      })
    }

    return {
      IfStatement: checkIf,
      ...Object.fromEntries(LOOPS.map((type) => [type, (node) => requireBlock(node.body, 'loopBody')]))
    }
  }
}
