/*
 * Copyright (c) 2006-2009 Erin Catto http://www.box2d.org
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

import { Vec2, XY } from '../Common/Math'

import { AABB, RayCastInput } from './Collision'
import { DynamicTree, TreeNode } from './DynamicTree'

export class Pair<T> {
  constructor(public proxyA: TreeNode<T>, public proxyB: TreeNode<T>) {}
}

/// The broad-phase is used for computing pairs and performing volume queries and ray casts.
/// This broad-phase does not persist pairs. Instead, this reports potentially new pairs.
/// It is up to the client to consume the new pairs and to track subsequent overlap.
export class BroadPhase<T> {
  readonly m_tree: DynamicTree<T> = new DynamicTree<T>()
  m_proxyCount = 0
  // public m_moveCapacity: number = 16;
  m_moveCount = 0
  readonly m_moveBuffer: Array<TreeNode<T> | null> = []
  // public m_pairCapacity: number = 16;
  m_pairCount = 0
  readonly m_pairBuffer: Array<Pair<T>> = []
  // public m_queryProxyId: number = 0;

  /// Create a proxy with an initial AABB. Pairs are not reported until
  /// UpdatePairs is called.
  CreateProxy(aabb: AABB, userData: T): TreeNode<T> {
    const proxy: TreeNode<T> = this.m_tree.CreateProxy(aabb, userData)
    ++this.m_proxyCount
    this.BufferMove(proxy)
    return proxy
  }

  /// Destroy a proxy. It is up to the client to remove any pairs.
  DestroyProxy(proxy: TreeNode<T>): void {
    this.UnBufferMove(proxy)
    --this.m_proxyCount
    this.m_tree.DestroyProxy(proxy)
  }

  /// Call MoveProxy as many times as you like, then when you are done
  /// call UpdatePairs to finalized the proxy pairs (for your time step).
  MoveProxy(proxy: TreeNode<T>, aabb: AABB, displacement: Vec2): void {
    const buffer: boolean = this.m_tree.MoveProxy(proxy, aabb, displacement)
    if (buffer) {
      this.BufferMove(proxy)
    }
  }

  /// Call to trigger a re-processing of it's pairs on the next call to UpdatePairs.
  TouchProxy(proxy: TreeNode<T>): void {
    this.BufferMove(proxy)
  }

  /// Get the fat AABB for a proxy.
  // public GetFatAABB(proxy: TreeNode<T>): AABB {
  //   return this.m_tree.GetFatAABB(proxy);
  // }

  /// Get user data from a proxy. Returns NULL if the id is invalid.
  // public GetUserData(proxy: TreeNode<T>): T {
  //   return this.m_tree.GetUserData(proxy);
  // }

  /// Test overlap of fat AABBs.
  // public TestOverlap(proxyA: TreeNode<T>, proxyB: TreeNode<T>): boolean {
  //   const aabbA: AABB = this.m_tree.GetFatAABB(proxyA);
  //   const aabbB: AABB = this.m_tree.GetFatAABB(proxyB);
  //   return TestOverlapAABB(aabbA, aabbB);
  // }

  /// Get the number of proxies.
  GetProxyCount(): number {
    return this.m_proxyCount
  }

  /// Update the pairs. This results in pair callbacks. This can only add pairs.
  UpdatePairs(callback: (a: T, b: T) => void): void {
    // Reset pair buffer
    this.m_pairCount = 0

    // Perform tree queries for all moving proxies.
    for (let i = 0; i < this.m_moveCount; ++i) {
      const queryProxy: TreeNode<T> | null = this.m_moveBuffer[i]
      if (queryProxy === null) {
        continue
      }

      // This is called from box2d.DynamicTree::Query when we are gathering pairs.
      // boolean BroadPhase::QueryCallback(int32 proxyId);

      // We have to query the tree with the fat AABB so that
      // we don't fail to create a pair that may touch later.
      const fatAABB: AABB = queryProxy.aabb // this.m_tree.GetFatAABB(queryProxy);

      // Query tree, create pairs and add them pair buffer.
      this.m_tree.Query(fatAABB, (proxy: TreeNode<T>): boolean => {
        // A proxy cannot form a pair with itself.
        if (proxy.m_id === queryProxy.m_id) {
          return true
        }

        // const proxyA = proxy < queryProxy ? proxy : queryProxy;
        // const proxyB = proxy >= queryProxy ? proxy : queryProxy;
        let proxyA: TreeNode<T>
        let proxyB: TreeNode<T>
        if (proxy.m_id < queryProxy.m_id) {
          proxyA = proxy
          proxyB = queryProxy
        } else {
          proxyA = queryProxy
          proxyB = proxy
        }

        // Grow the pair buffer as needed.
        if (this.m_pairCount === this.m_pairBuffer.length) {
          this.m_pairBuffer[this.m_pairCount] = new Pair(proxyA, proxyB)
        } else {
          const pair: Pair<T> = this.m_pairBuffer[this.m_pairCount]
          pair.proxyA = proxyA
          pair.proxyB = proxyB
        }

        ++this.m_pairCount

        return true
      })
    }

    // Reset move buffer
    this.m_moveCount = 0

    // Sort the pair buffer to expose duplicates.
    this.m_pairBuffer.length = this.m_pairCount
    this.m_pairBuffer.sort(PairLessThan)

    // Send the pairs back to the client.
    let i = 0
    while (i < this.m_pairCount) {
      const primaryPair: Pair<T> = this.m_pairBuffer[i]
      const userDataA: T = primaryPair.proxyA.userData // this.m_tree.GetUserData(primaryPair.proxyA);
      const userDataB: T = primaryPair.proxyB.userData // this.m_tree.GetUserData(primaryPair.proxyB);

      callback(userDataA, userDataB)
      ++i

      // Skip any duplicate pairs.
      while (i < this.m_pairCount) {
        const pair: Pair<T> = this.m_pairBuffer[i]
        if (
          pair.proxyA.m_id !== primaryPair.proxyA.m_id ||
          pair.proxyB.m_id !== primaryPair.proxyB.m_id
        ) {
          break
        }
        ++i
      }
    }

    // Try to keep the tree balanced.
    // this.m_tree.Rebalance(4);
  }

  /// Query an AABB for overlapping proxies. The callback class
  /// is called for each proxy that overlaps the supplied AABB.
  Query(aabb: AABB, callback: (node: TreeNode<T>) => boolean): void {
    this.m_tree.Query(aabb, callback)
  }

  QueryPoint(point: Vec2, callback: (node: TreeNode<T>) => boolean): void {
    this.m_tree.QueryPoint(point, callback)
  }

  /// Ray-cast against the proxies in the tree. This relies on the callback
  /// to perform a exact ray-cast in the case were the proxy contains a shape.
  /// The callback also performs the any collision filtering. This has performance
  /// roughly equal to k * log(n), where k is the number of collisions and n is the
  /// number of proxies in the tree.
  /// @param input the ray-cast input data. The ray extends from p1 to p1 + maxFraction * (p2 - p1).
  /// @param callback a callback class that is called for each proxy that is hit by the ray.
  RayCast(
    input: RayCastInput,
    callback: (input: RayCastInput, node: TreeNode<T>) => number
  ): void {
    this.m_tree.RayCast(input, callback)
  }

  /// Get the height of the embedded tree.
  GetTreeHeight(): number {
    return this.m_tree.GetHeight()
  }

  /// Get the balance of the embedded tree.
  GetTreeBalance(): number {
    return this.m_tree.GetMaxBalance()
  }

  /// Get the quality metric of the embedded tree.
  GetTreeQuality(): number {
    return this.m_tree.GetAreaRatio()
  }

  /// Shift the world origin. Useful for large worlds.
  /// The shift formula is: position -= newOrigin
  /// @param newOrigin the new origin with respect to the old origin
  ShiftOrigin(newOrigin: XY): void {
    this.m_tree.ShiftOrigin(newOrigin)
  }

  BufferMove(proxy: TreeNode<T>): void {
    this.m_moveBuffer[this.m_moveCount] = proxy
    ++this.m_moveCount
  }

  UnBufferMove(proxy: TreeNode<T>): void {
    const i: number = this.m_moveBuffer.indexOf(proxy)
    this.m_moveBuffer[i] = null
  }
}

/// This is used to sort pairs.
export function PairLessThan<T>(pair1: Pair<T>, pair2: Pair<T>): number {
  if (pair1.proxyA.m_id === pair2.proxyA.m_id) {
    return pair1.proxyB.m_id - pair2.proxyB.m_id
  }

  return pair1.proxyA.m_id - pair2.proxyA.m_id
}
