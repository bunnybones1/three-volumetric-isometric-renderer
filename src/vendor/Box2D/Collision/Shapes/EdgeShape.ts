/*
 * Copyright (c) 2006-2010 Erin Catto http://www.box2d.org
 *
 * This software is provided 'as-is', without any express or implied
 * warranty.  In no event will the authors be held liable for any damages
 * arising from the use of this software.
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 * 1. The origin of this software must not be misrepresented; you must not
 * claim that you wrote the original software. If you use this software
 * in a product, an acknowledgment in the product documentation would be
 * appreciated but is not required.
 * 2. Altered source versions must be plainly marked as such, and must not be
 * misrepresented as being the original software.
 * 3. This notice may not be removed or altered from any source distribution.
 */

// DEBUG: import { Assert } from "../../Common/Settings";
import { Rot, Transform, Vec2, XY } from '../../Common/Math'
import { polygonRadius } from '../../Common/Settings'
import { AABB, RayCastInput, RayCastOutput } from '../Collision'
import { DistanceProxy } from '../Distance'

import { MassData, Shape, ShapeType } from './Shape'

/// A line segment (edge) shape. These can be connected in chains or loops
/// to other edge shapes. The connectivity information is used to ensure
/// correct contact normals.
export class EdgeShape extends Shape {
  // #if ENABLE_PARTICLE
  /// @see Shape::ComputeDistance
  private static ComputeDistance_s_v1 = new Vec2()
  private static ComputeDistance_s_v2 = new Vec2()
  private static ComputeDistance_s_d = new Vec2()
  private static ComputeDistance_s_s = new Vec2()
  // #endif

  /// Implement Shape.
  // p = p1 + t * d
  // v = v1 + s * e
  // p1 + t * d = v1 + s * e
  // s * e - t * d = p1 - v1
  private static RayCast_s_p1 = new Vec2()
  private static RayCast_s_p2 = new Vec2()
  private static RayCast_s_d = new Vec2()
  private static RayCast_s_e = new Vec2()
  private static RayCast_s_q = new Vec2()
  private static RayCast_s_r = new Vec2()

  /// @see Shape::ComputeAABB
  private static ComputeAABB_s_v1 = new Vec2()
  private static ComputeAABB_s_v2 = new Vec2()
  readonly m_vertex1: Vec2 = new Vec2()
  readonly m_vertex2: Vec2 = new Vec2()
  readonly m_vertex0: Vec2 = new Vec2()
  readonly m_vertex3: Vec2 = new Vec2()
  m_hasVertex0 = false
  m_hasVertex3 = false

  constructor() {
    super(ShapeType.e_edgeShape, polygonRadius)
  }

  /// Set this as an isolated edge.
  Set(v1: XY, v2: XY): EdgeShape {
    this.m_vertex1.Copy(v1)
    this.m_vertex2.Copy(v2)
    this.m_hasVertex0 = false
    this.m_hasVertex3 = false
    return this
  }

  /// Implement Shape.
  Clone(): EdgeShape {
    return new EdgeShape().Copy(this)
  }

  Copy(other: EdgeShape): EdgeShape {
    super.Copy(other)

    // DEBUG: Assert(other instanceof EdgeShape);

    this.m_vertex1.Copy(other.m_vertex1)
    this.m_vertex2.Copy(other.m_vertex2)
    this.m_vertex0.Copy(other.m_vertex0)
    this.m_vertex3.Copy(other.m_vertex3)
    this.m_hasVertex0 = other.m_hasVertex0
    this.m_hasVertex3 = other.m_hasVertex3

    return this
  }

  /// @see Shape::GetChildCount
  GetChildCount(): number {
    return 1
  }

  /// @see Shape::TestPoint
  TestPoint(xf: Transform, p: Vec2): boolean {
    return false
  }
  ComputeDistance(
    xf: Transform,
    p: Vec2,
    normal: Vec2,
    childIndex: number
  ): number {
    const v1 = Transform.MulXV(
      xf,
      this.m_vertex1,
      EdgeShape.ComputeDistance_s_v1
    )
    const v2 = Transform.MulXV(
      xf,
      this.m_vertex2,
      EdgeShape.ComputeDistance_s_v2
    )

    const d = Vec2.SubVV(p, v1, EdgeShape.ComputeDistance_s_d)
    const s = Vec2.SubVV(v2, v1, EdgeShape.ComputeDistance_s_s)
    const ds = Vec2.DotVV(d, s)
    if (ds > 0) {
      const s2 = Vec2.DotVV(s, s)
      if (ds > s2) {
        Vec2.SubVV(p, v2, d)
      } else {
        d.SelfMulSub(ds / s2, s)
      }
    }
    normal.Copy(d)
    return normal.Normalize()
  }
  RayCast(
    output: RayCastOutput,
    input: RayCastInput,
    xf: Transform,
    childIndex: number
  ): boolean {
    // Put the ray into the edge's frame of reference.
    const p1: Vec2 = Transform.MulTXV(xf, input.p1, EdgeShape.RayCast_s_p1)
    const p2: Vec2 = Transform.MulTXV(xf, input.p2, EdgeShape.RayCast_s_p2)
    const d: Vec2 = Vec2.SubVV(p2, p1, EdgeShape.RayCast_s_d)

    const v1: Vec2 = this.m_vertex1
    const v2: Vec2 = this.m_vertex2
    const e: Vec2 = Vec2.SubVV(v2, v1, EdgeShape.RayCast_s_e)
    const normal: Vec2 = output.normal.Set(e.y, -e.x).SelfNormalize()

    // q = p1 + t * d
    // dot(normal, q - v1) = 0
    // dot(normal, p1 - v1) + t * dot(normal, d) = 0
    const numerator: number = Vec2.DotVV(normal, Vec2.SubVV(v1, p1, Vec2.s_t0))
    const denominator: number = Vec2.DotVV(normal, d)

    if (denominator === 0) {
      return false
    }

    const t: number = numerator / denominator
    if (t < 0 || input.maxFraction < t) {
      return false
    }

    const q: Vec2 = Vec2.AddVMulSV(p1, t, d, EdgeShape.RayCast_s_q)

    // q = v1 + s * r
    // s = dot(q - v1, r) / dot(r, r)
    const r: Vec2 = Vec2.SubVV(v2, v1, EdgeShape.RayCast_s_r)
    const rr: number = Vec2.DotVV(r, r)
    if (rr === 0) {
      return false
    }

    const s: number = Vec2.DotVV(Vec2.SubVV(q, v1, Vec2.s_t0), r) / rr
    if (s < 0 || 1 < s) {
      return false
    }

    output.fraction = t
    Rot.MulRV(xf.q, output.normal, output.normal)
    if (numerator > 0) {
      output.normal.SelfNeg()
    }
    return true
  }
  ComputeAABB(aabb: AABB, xf: Transform, childIndex: number): void {
    const v1: Vec2 = Transform.MulXV(
      xf,
      this.m_vertex1,
      EdgeShape.ComputeAABB_s_v1
    )
    const v2: Vec2 = Transform.MulXV(
      xf,
      this.m_vertex2,
      EdgeShape.ComputeAABB_s_v2
    )

    Vec2.MinV(v1, v2, aabb.lowerBound)
    Vec2.MaxV(v1, v2, aabb.upperBound)

    const r: number = this.m_radius
    aabb.lowerBound.SelfSubXY(r, r)
    aabb.upperBound.SelfAddXY(r, r)
  }

  /// @see Shape::ComputeMass
  ComputeMass(massData: MassData, density: number): void {
    massData.mass = 0
    Vec2.MidVV(this.m_vertex1, this.m_vertex2, massData.center)
    massData.I = 0
  }

  SetupDistanceProxy(proxy: DistanceProxy, index: number): void {
    proxy.m_vertices = proxy.m_buffer
    proxy.m_vertices[0].Copy(this.m_vertex1)
    proxy.m_vertices[1].Copy(this.m_vertex2)
    proxy.m_count = 2
    proxy.m_radius = this.m_radius
  }

  ComputeSubmergedArea(
    normal: Vec2,
    offset: number,
    xf: Transform,
    c: Vec2
  ): number {
    c.SetZero()
    return 0
  }

  Dump(log: (format: string, ...args: any[]) => void): void {
    log('    const shape: EdgeShape = new EdgeShape();\n')
    log('    shape.m_radius = %.15f;\n', this.m_radius)
    log(
      '    shape.m_vertex0.Set(%.15f, %.15f);\n',
      this.m_vertex0.x,
      this.m_vertex0.y
    )
    log(
      '    shape.m_vertex1.Set(%.15f, %.15f);\n',
      this.m_vertex1.x,
      this.m_vertex1.y
    )
    log(
      '    shape.m_vertex2.Set(%.15f, %.15f);\n',
      this.m_vertex2.x,
      this.m_vertex2.y
    )
    log(
      '    shape.m_vertex3.Set(%.15f, %.15f);\n',
      this.m_vertex3.x,
      this.m_vertex3.y
    )
    log('    shape.m_hasVertex0 = %s;\n', this.m_hasVertex0)
    log('    shape.m_hasVertex3 = %s;\n', this.m_hasVertex3)
  }
}
