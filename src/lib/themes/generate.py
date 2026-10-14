"""
Writes the theme CSS next to this file from each theme's own roles, as its source repo
defines them, the source named beside every value. Run after changing one:

    python3 src/lib/themes/generate.py

A new theme is a write() here, then an entry in BUILT_INS in $lib/theme.svelte.ts.
"""
import os
import textwrap

OUT = os.path.dirname(os.path.abspath(__file__))

# every twinkleplop token, by the role that colours it
TOKENS = {
    'boolean': 'boolean', 'comment': 'comment', 'identifier': 'variable', 'keyword': 'keyword',
    'number': 'number', 'operator': 'operator', 'punctuation': 'punct', 'regex': 'regex',
    'string': 'string', 'template': 'string', 'attribute': 'attribute', 'builtin': 'builtin',
    'class_name': 'type', 'constant': 'constant', 'decorator': 'decorator', 'lifetime': 'keyword',
    'namespace': 'namespace', 'parameter': 'parameter', 'property': 'property', 'type': 'type',
    'variable': 'variable', 'variant': 'constant', 'function': 'function', 'attr_name': 'attribute',
    'doctype': 'comment', 'entity': 'escape', 'tag_name': 'tag', 'css_variable': 'variable',
    'selector': 'tag', 'selector_class': 'type', 'selector_id': 'constant',
    'selector_pseudo': 'keyword', 'unit': 'keyword', 'changed': 'mod', 'changed_marker': 'mod',
    'deleted': 'del', 'deleted_marker': 'del', 'hash': 'comment', 'heading': 'heading',
    'inserted': 'add', 'inserted_marker': 'add', 'label': 'comment', 'autolink': 'string',
    'bold': 'fg', 'code': 'string', 'code_block': 'string', 'code_language': 'type',
    'italic': 'fg', 'link_text': 'string', 'strike': 'fg', 'url': 'string', 'url_link': 'string',
    'url_title': 'string', 'autolink_open': 'string', 'autolink_close': 'string',
    'bold_open': 'fg', 'bold_close': 'fg', 'code_open': 'string', 'code_close': 'string',
    'italic_open': 'fg', 'italic_close': 'fg', 'link_text_open': 'string',
    'link_text_close': 'string', 'strike_open': 'fg', 'strike_close': 'fg',
    'blockquote_marker': 'comment', 'code_fence': 'comment', 'front_matter_marker': 'comment',
    'heading_marker': 'heading', 'hr': 'comment', 'list_marker': 'keyword', 'task_marker': 'add',
    'escape': 'escape', 'hard_break': 'comment', 'expression': 'keyword',
    'svelte_block': 'keyword', 'svelte_directive': 'attribute', 'output': 'fg', 'prompt': 'fg',
    'prompt_prefix': 'keyword', 'raw_code_block': 'fg', 'raw_front_matter': 'fg',
    'raw_json': 'fg', 'raw_markup': 'fg', 'raw_script': 'fg', 'raw_shell': 'fg',
    'raw_style': 'fg', 'raw_svelte_expression': 'fg', 'string_escape': 'escape',
    'format': 'escape', 'attr_sigil': 'keyword', 'bit': 'number',
    'array_table_header': 'heading', 'datetime': 'number', 'block_scalar_header': 'keyword',
    'directive': 'decorator', 'doc_marker': 'comment', 'plain_scalar': 'string', 'tag': 'type',
    'null': 'constant',
}
UI = ['canvas', 'surface', 'subtle', 'line', 'fg', 'muted', 'faint', 'add', 'del', 'mod', 'move']


def mix(a, b, t):
    """a over b at t, as 6-digit hex: for the few colours a theme only gives with opacity"""
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x * t + y * (1 - t)):02x}' for x, y in zip(pa, pb))


def write(name, title, about, dark, r):
    missing = [k for k in UI + list(set(TOKENS.values())) if k not in r]
    assert not missing, (name, missing)
    rides = 'Rides on .dark, anything not set here falls back to it' if dark else \
        'Over the default light theme, anything not set here falls back to it'
    about = (f'{title}, after {about}, generated from its own roles: UI from its editor colours, '
             f'syntax from its highlight groups. {rides}')
    wrapped = textwrap.wrap(about, 88)
    lines = [('/* ' if i == 0 else '   ') + line + (' */' if i == len(wrapped) - 1 else '')
             for i, line in enumerate(wrapped)]
    lines += [
             # .dark beside it outweighs :root.dark whatever order the CSS comes in
             f':root.dark.{name} {{' if dark else f':root.{name} {{']
    lines += [f'\t--{k}: {r[k].lower()};' for k in UI if k != 'move' or r.get('move')]
    lines.append('')
    lines += [f'\t--twp-{t}: {r[role].lower()};' for t, role in TOKENS.items()]
    lines.append('}')
    open(f'{OUT}/{name}.css', 'w').write('\n'.join(lines) + '\n')


# raunofreiberg/vesper, themes/Vesper-dark-color-theme.json
v = dict(bg='#101010', fg='#ffffff', orange='#ffc799', mint='#99ffe4', red='#ff8080', gray='#a0a0a0')
write('vesper', 'Vesper', 'github.com/raunofreiberg/vesper', True, dict(
    canvas=v['bg'],  # editor.background
    surface='#161616',  # tab.activeBackground, editorHoverWidget.background
    subtle='#1c1c1c',  # input.background
    line='#282828',  # editorHoverWidget.border, list.hoverBackground
    fg=v['fg'], muted=v['gray'],  # sideBarTitle, statusBar.foreground
    faint='#505050',  # editorLineNumber.foreground
    add=v["mint"], mod=v["orange"],  # editorGutter.*
    move=None,  # no fourth hue, moved keeps the default dark one
    **{'del': v['red']},
    comment=mix('#8b8b8b', v['bg'], 0x94 / 255),  # #8b8b8b94 over the background
    keyword=v['gray'], operator=v['gray'], punct=v['gray'], string=v['mint'],
    escape=v['gray'], regex=v['gray'], number=v['orange'], boolean=v['orange'],
    constant=v['fg'],  # variable.other.constant falls to variable
    function=v['orange'], type=v['orange'], namespace=v['orange'], property=v['fg'],
    variable=v['fg'], parameter=v['fg'], builtin=v['orange'], tag=v['orange'],
    attribute=v['gray'],  # entity.other.attribute-name, html only is orange
    decorator=v['fg'], heading=v['orange'],
))

# rebelot/kanagawa.nvim, colors.lua palette and the dragon theme in themes.lua
write('kanagawa-dragon', 'Kanagawa Dragon', 'github.com/rebelot/kanagawa.nvim', True, dict(
    canvas='#0d0c0c',  # bg_m3 dragonBlack0
    surface='#181616',  # bg dragonBlack3
    subtle='#282727',  # bg_p1 dragonBlack4
    line='#393836',  # bg_p2 dragonBlack5
    fg='#c5c9c5',  # dragonWhite
    muted='#9e9b93',  # dragonGray2
    faint='#625e5a',  # nontext dragonBlack6
    add='#76946a', mod='#dca561', move='#a292a3',  # vcs autumnGreen, autumnYellow; dragonPink
    **{'del': '#c34043'},  # vcs autumnRed
    comment='#737c73', keyword='#8992a7', operator='#c4746e', punct='#9e9b93',
    string='#8a9a7b', escape='#c4746e', regex='#c4746e', number='#a292a3',
    boolean='#b6927b', constant='#b6927b', function='#8ba4b0', type='#8ea4a2',
    namespace='#8ea4a2',  # @module, Structure -> Type
    property='#c4b28a',  # @variable.member = identifier
    variable='#c5c9c5', parameter='#a6a69c', builtin='#c4746e',  # @variable.builtin = special2
    tag='#949fb5',  # @tag -> Tag -> Special = special1
    attribute='#c4b28a',  # @tag.attribute = identifier
    decorator='#b6927b',  # @attribute -> Constant
    heading='#8ba4b0',  # @markup.heading -> Function
))


# catppuccin/palette palette.json, roles from the style guide and catppuccin/nvim
def catppuccin(c, mod):
    return dict(
        canvas=c['mantle'], surface=c['base'], subtle=c['surface0'], line=c['surface1'],
        fg=c['text'], muted=c['subtext0'], faint=c['overlay1'],  # subtle, line numbers
        add=c['green'], mod=c[mod], move=c['pink'], **{'del': c['red']},
        comment=c['overlay2'], keyword=c['mauve'], operator=c['sky'], punct=c['overlay2'],
        string=c['green'], escape=c['pink'], regex=c['pink'], number=c['peach'],
        boolean=c['peach'], constant=c['peach'], function=c['blue'], type=c['yellow'],
        namespace=c['yellow'], property=c['lavender'], variable=c['text'],
        parameter=c['maroon'], builtin=c['red'], tag=c['blue'], attribute=c['yellow'],
        decorator=c['yellow'], heading=c['blue'],
    )


# catppuccin/palette, palette.json
LATTE = dict(rosewater='#dc8a78', flamingo='#dd7878', pink='#ea76cb', mauve='#8839ef',
             red='#d20f39', maroon='#e64553', peach='#fe640b', yellow='#df8e1d', green='#40a02b',
             teal='#179299', sky='#04a5e5', sapphire='#209fb5', blue='#1e66f5',
             lavender='#7287fd', text='#4c4f69', subtext1='#5c5f77', subtext0='#6c6f85',
             overlay2='#7c7f93', overlay1='#8c8fa1', overlay0='#9ca0b0', surface2='#acb0be',
             surface1='#bcc0cc', surface0='#ccd0da', base='#eff1f5', mantle='#e6e9ef',
             crust='#dce0e8')
MOCHA = dict(rosewater='#f5e0dc', flamingo='#f2cdcd', pink='#f5c2e7', mauve='#cba6f7',
             red='#f38ba8', maroon='#eba0ac', peach='#fab387', yellow='#f9e2af', green='#a6e3a1',
             teal='#94e2d5', sky='#89dceb', sapphire='#74c7ec', blue='#89b4fa',
             lavender='#b4befe', text='#cdd6f4', subtext1='#bac2de', subtext0='#a6adc8',
             overlay2='#9399b2', overlay1='#7f849c', overlay0='#6c7086', surface2='#585b70',
             surface1='#45475a', surface0='#313244', base='#1e1e2e', mantle='#181825',
             crust='#11111b')
# changed text is blue in the style guide's diff section
write('catppuccin-latte', 'Catppuccin Latte', 'github.com/catppuccin/catppuccin', False,
      catppuccin(LATTE, 'blue'))
write('catppuccin-mocha', 'Catppuccin Mocha', 'github.com/catppuccin/catppuccin', True,
      catppuccin(MOCHA, 'blue'))

# rose-pine/neovim, palette.lua dawn and rose-pine.lua
p = dict(base='#faf4ed', surface='#fffaf3', overlay='#f2e9e1', muted='#9893a5', subtle='#797593',
         text='#464261', love='#b4637a', gold='#ea9d34', rose='#d7827e', pine='#286983',
         foam='#56949f', iris='#907aa9', hl_med='#dfdad9')
write('rose-pine-dawn', 'Rosé Pine Dawn', 'github.com/rose-pine/neovim', False, dict(
    canvas=p['base'], surface=p['surface'], subtle=p['overlay'], line=p['hl_med'],
    fg=p['text'], muted=p['subtle'], faint=p['muted'],
    add=p['foam'], mod=p['rose'], move=p['pine'], **{'del': p['love']},  # git_add, _change, _delete, _rename
    comment=p['subtle'], keyword=p['pine'], operator=p['subtle'], punct=p['subtle'],
    string=p['gold'], escape=p['pine'], regex=p['iris'], number=p['gold'], boolean=p['rose'],
    constant=p['gold'], function=p['rose'], type=p['foam'], namespace=p['text'],
    property=p['foam'], variable=p['text'], parameter=p['iris'], builtin=p['love'],
    tag=p['foam'], attribute=p['iris'], decorator=p['iris'], heading=p['foam'],
))

# ellisonleao/gruvbox.nvim, the dark palette and its highlight groups
g = dict(bg0_h='#1d2021', bg0='#282828', bg0_s='#32302f', bg1='#3c3836', bg4='#7c6f64',
         fg1='#ebdbb2', fg4='#a89984', red='#fb4934', green='#b8bb26', yellow='#fabd2f',
         blue='#83a598', purple='#d3869b', aqua='#8ec07c', orange='#fe8019', gray='#928374')
write('gruvbox-dark', 'Gruvbox Dark', 'github.com/ellisonleao/gruvbox.nvim', True, dict(
    canvas=g['bg0_h'], surface=g['bg0'], subtle=g['bg0_s'], line=g['bg1'],
    fg=g['fg1'], muted=g['fg4'], faint=g['bg4'],  # LineNr bg4
    add=g['green'], mod=g['orange'], move=g['purple'], **{'del': g['red']},  # GitSigns*
    comment=g['gray'], keyword=g['red'], operator=g['orange'], punct=g['orange'],  # Delimiter
    string=g['green'], escape=g['orange'], regex=g['green'], number=g['purple'],
    boolean=g['purple'], constant=g['purple'], function=g['green'], type=g['yellow'],
    namespace=g['fg1'], property=g['blue'], variable=g['fg1'], parameter=g['blue'],
    builtin=g['orange'], tag=g['orange'],  # Tag -> Special
    attribute=g['blue'], decorator=g['aqua'], heading=g['green'],  # Title
))

# folke/tokyonight.nvim, colors/night.lua over storm.lua, groups/base.lua and treesitter.lua
t = dict(bg='#1a1b26', bg_dark='#16161e', bg_hl='#292e42', fg='#c0caf5', fg_dark='#a9b1d6',
         gutter='#3b4261', comment='#565f89', dark3='#545c7e', dark5='#737aa2', blue='#7aa2f7',
         blue1='#2ac3de', blue5='#89ddff', blue6='#b4f9f8', cyan='#7dcfff', green='#9ece6a',
         green1='#73daca', magenta='#bb9af7', orange='#ff9e64', purple='#9d7cd8', red='#f7768e',
         yellow='#e0af68', git_add='#449dab', git_change='#6183bb', git_delete='#914c54')
write('tokyo-night', 'Tokyo Night', 'github.com/folke/tokyonight.nvim', True, dict(
    canvas=t['bg_dark'], surface=t['bg'], subtle=t['bg_hl'], line=t['gutter'],
    fg=t['fg'], muted=t['dark5'], faint=t['dark3'],
    add=t['git_add'], mod=t['git_change'], move=t['magenta'], **{'del': t['git_delete']},
    comment=t['comment'], keyword=t['purple'], operator=t['blue5'], punct=t['fg_dark'],  # brackets
    string=t['green'], escape=t['magenta'], regex=t['blue6'], number=t['orange'],
    boolean=t['orange'], constant=t['orange'], function=t['blue'], type=t['blue1'],
    namespace=t['cyan'],  # @module -> Include -> PreProc
    property=t['green1'], variable=t['fg'], parameter=t['yellow'], builtin=t['red'],
    tag=t['magenta'],  # @tag -> Label -> Statement
    attribute=t['green1'], decorator=t['cyan'], heading=t['blue'],
))

# nordtheme/vim, colors/nord.vim, roles as nordtheme.com's docs give them
n = {f'n{i}': c for i, c in enumerate(['#2e3440', '#3b4252', '#434c5e', '#4c566a', '#d8dee9',
                                         '#e5e9f0', '#eceff4', '#8fbcbb', '#88c0d0', '#81a1c1',
                                         '#5e81ac', '#bf616a', '#d08770', '#ebcb8b', '#a3be8c',
                                         '#b48ead'])}
write('nord', 'Nord', 'github.com/nordtheme/vim', True, dict(
    canvas=n['n0'], surface=n['n0'], subtle=n['n1'], line=n['n2'],  # Normal, CursorLine, VertSplit
    fg=n['n4'], muted=mix(n['n4'], n['n0'], 0.65),  # nord has no secondary text colour
    faint=n['n3'],  # LineNr
    add=n['n14'], mod=n['n13'], move=n['n15'], **{'del': n['n11']},  # GitGutter*
    comment='#616e88',  # nord3 bright
    keyword=n['n9'], operator=n['n9'], punct=n['n6'],  # Delimiter
    string=n['n14'], escape=n['n13'], regex=n['n13'], number=n['n15'], boolean=n['n9'],
    constant=n['n4'], function=n['n8'], type=n['n7'], namespace=n['n4'], property=n['n4'],
    variable=n['n4'], parameter=n['n4'], builtin=n['n9'], tag=n['n9'], attribute=n['n7'],
    decorator=n['n12'], heading=n['n8'],
))

# altercation/vim-colors-solarized, light: the base tones swapped, canonical #859900 green
s = dict(base01='#586e75', base00='#657b83', base1='#93a1a1', base2='#eee8d5', base3='#fdf6e3',
         yellow='#b58900', orange='#cb4b16', red='#dc322f', violet='#6c71c4', blue='#268bd2',
         cyan='#2aa198', green='#859900')
write('solarized-light', 'Solarized Light', 'github.com/altercation/vim-colors-solarized', False, dict(
    canvas=s['base2'], surface=s['base3'], subtle=s['base2'],
    line=mix(s['base1'], s['base3'], 0.3),  # between, solarized has no border tone
    fg=s['base00'], muted=s['base1'], faint=mix(s['base1'], s['base3'], 0.6),
    add=s['green'], mod=s['yellow'], move=s['violet'], **{'del': s['red']},  # Diff*
    comment=s['base1'], keyword=s['green'], operator=s['green'],  # Statement
    punct=s['base00'], string=s['cyan'], escape=s['red'], regex=s['red'],  # Constant, Special
    number=s['cyan'], boolean=s['cyan'], constant=s['cyan'], function=s['blue'],
    type=s['yellow'], namespace=s['orange'],  # Identifier, Type, PreProc
    property=s['blue'], variable=s['blue'], parameter=s['blue'], builtin=s['red'],
    tag=s['blue'], attribute=s['base00'],  # htmlTagName, htmlArg
    decorator=s['orange'], heading=s['orange'],  # Title
))
