import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "@/components/settings/Toggle";
import { Stepper } from "@/components/settings/Stepper";
import { Segmented } from "@/components/settings/Segmented";
import { Dropdown } from "@/components/settings/Dropdown";
import { ChipList } from "@/components/settings/ChipList";

describe("Toggle", () => {
  it("emits the flipped value on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} ariaLabel="t" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Stepper", () => {
  it("clamps at max and rounds to the step grid", () => {
    const onChange = vi.fn();
    render(<Stepper value={2.0} min={1} max={2} step={0.1} onChange={onChange} ariaLabel="s" />);
    fireEvent.click(screen.getByLabelText("Increase"));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Decrease"));
    expect(onChange).toHaveBeenCalledWith(1.9);
  });
});

describe("Segmented", () => {
  it("emits the chosen segment", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="block"
        options={[
          { value: "bar", label: "Bar" },
          { value: "block", label: "Block" },
        ]}
        onChange={onChange}
        ariaLabel="cursor"
      />
    );
    fireEvent.click(screen.getByText("Bar"));
    expect(onChange).toHaveBeenCalledWith("bar");
  });
});

describe("Dropdown", () => {
  it("emits the selected value", () => {
    const onChange = vi.fn();
    render(
      <Dropdown
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
        ariaLabel="d"
      />
    );
    fireEvent.change(screen.getByLabelText("d"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("ChipList", () => {
  it("adds a chip on Enter and removes on ×", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ChipList values={["node_modules"]} onChange={onChange} ariaLabel="dirs" />
    );
    const input = screen.getByLabelText("dirs").querySelector("input")!;
    fireEvent.change(input, { target: { value: "dist" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["node_modules", "dist"]);

    onChange.mockClear();
    rerender(<ChipList values={["node_modules"]} onChange={onChange} ariaLabel="dirs" />);
    fireEvent.click(screen.getByLabelText("Remove node_modules"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
