# test

```ts
import { marked } from "marked";

export class Markdown {
  renderer: InstanceType<typeof marked.Renderer>;

  constructor() {
    this.renderer = new marked.Renderer();
    this.init();
  }

  // TODO: add prettier
  format(content: string) {
    return content;
  }

  init() {
    this.renderer.heading = ({ tokens, depth }) => {
      const content = this.renderer.parser.parse(tokens);
      switch (depth) {
        case 1:
          return `<h1 class="${CLASS.H1}">${content}</h1>`;
        case 2:
          return `<h2 class="${CLASS.H2}">${content}</h2>`;
        default:
          return `<h${depth} class="my-4">${content}</h${depth}>`;
      }
    };
    marked.setOptions({ renderer: this.renderer });
  }

  parse(content: string) {
    const formatted = this.format(content);
    return marked.parse(formatted);
  }
}

// TODO: add style details
const CLASS = {
  H1: "font-bold text-3xl",
  H2: "font-semi-bold text-2xl",
};
```

